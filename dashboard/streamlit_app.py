"""
AI FinOps Flow Dashboard
Visibilidad de costes · Proyecciones ML · Análisis de routing
"""

import os
from datetime import timedelta

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import requests
import streamlit as st
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures

BACKEND_URL = os.getenv("FINOPS_BACKEND_URL", "http://localhost:3000")
DASHBOARD_ENDPOINT = f"{BACKEND_URL.rstrip('/')}/v1/flow-dashboard"

COLORS = {
    "llama3.2:3b": "#00A651",
    "mistral:7b": "#003DA5",
    "llama-3.1-8b-instant": "#FF6B00",
    "default": "#8C8C8C",
}
ROUTING_COLORS = {
    "default_low_cost": "#00A651",
    "quality_reasoning_keywords": "#003DA5",
    "cost_guardrail_long_prompt": "#FF6B00",
    "budget_guardrail_critical": "#D0021B",
    "manual_request_honored": "#7B61FF",
    "fallback_invalid_requested_model": "#8C8C8C",
}

st.set_page_config(page_title="AI FinOps Dashboard", page_icon="📊", layout="wide")

st.markdown("""
<style>
    .metric-card {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 16px 20px;
    }
    .section-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 8px;
        opacity: 0.9;
    }
</style>
""", unsafe_allow_html=True)


@st.cache_data(ttl=10)
def load_data() -> dict:
    r = requests.get(DASHBOARD_ENDPOINT, timeout=10)
    r.raise_for_status()
    return r.json()


def money(v) -> str:
    v = float(v or 0)
    return f"${v:,.4f}" if v >= 0.01 else f"${v:,.8f}"


def pct(v) -> str:
    return f"{float(v or 0) * 100:.1f}%"


def color_for_model(m: str) -> str:
    return COLORS.get(m, COLORS["default"])


def fit_predict(y: np.ndarray, steps: int, max_degree: int = 2) -> np.ndarray:
    """
    Ajusta una regresión polinómica sobre una serie `y` (índice = orden temporal)
    y proyecta `steps` puntos futuros. El grado se adapta automáticamente al
    número de muestras disponibles (con solo 2 puntos cae a una recta simple),
    para que la proyección pueda mostrarse desde el primer momento de la demo
    y no dependa de tener varios días de histórico acumulados.
    """
    n = len(y)
    if n < 2:
        return np.array([])

    degree = min(max_degree, max(1, n - 1))
    X = np.arange(n).reshape(-1, 1)
    poly = PolynomialFeatures(degree=degree, include_bias=False)
    X_poly = poly.fit_transform(X)

    model = LinearRegression().fit(X_poly, y)

    X_future = np.arange(n, n + steps).reshape(-1, 1)
    future_poly = poly.transform(X_future)
    preds = model.predict(future_poly)
    return np.maximum(preds, 0)


def predict_future(daily_df: pd.DataFrame, days_ahead: int = 14, degree: int = 2):
    """
    Proyección diaria (tendencia de uso a medio plazo). Requiere al menos
    2 días distintos de histórico; con 2-3 usa recta, con más grado 2.
    Retorna un DataFrame con las columnas day, tokens_pred, cost_pred.
    """
    if len(daily_df) < 2:
        return pd.DataFrame()

    df = daily_df.copy().sort_values("day").reset_index(drop=True)
    df["total_tokens"] = df["prompt_tokens"] + df["completion_tokens"]

    tokens_pred = fit_predict(df["total_tokens"].values, days_ahead, degree)
    cost_pred = fit_predict(df["total_cost_usd"].values, days_ahead, degree)

    last_day = df["day"].iloc[-1]
    future_days = [last_day + timedelta(days=i + 1) for i in range(days_ahead)]

    return pd.DataFrame({"day": future_days, "tokens_pred": tokens_pred, "cost_pred": cost_pred})


def predict_sequence(seq_df: pd.DataFrame, steps_ahead: int = 20):
    """
    Proyección "por solicitud" (no por fecha). Es la que garantiza que la
    predicción pueda enseñarse YA en una demo en vivo: basta con 2 llamadas
    al proxy para tener una tendencia de coste acumulado y tokens por request.
    """
    if len(seq_df) < 2:
        return pd.DataFrame()

    df = seq_df.copy().reset_index(drop=True)
    df["total_tokens"] = df["prompt_tokens"] + df["completion_tokens"]
    df["cumulative_cost_usd"] = df["total_cost_usd"].cumsum()

    cost_pred = fit_predict(df["cumulative_cost_usd"].values, steps_ahead)
    tokens_pred = fit_predict(df["total_tokens"].values, steps_ahead)

    last_idx = df["id"].iloc[-1]
    future_idx = [last_idx + i + 1 for i in range(steps_ahead)]

    return pd.DataFrame({
        "request_idx": future_idx,
        "cumulative_cost_pred": cost_pred,
        "tokens_pred": tokens_pred
    })


# ──────────────────────── SIDEBAR ────────────────────────
with st.sidebar:
    st.image("https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Mercedes-Logo.svg/240px-Mercedes-Logo.svg.png", width=60)
    st.title("AI FinOps")
    st.caption("Mercedes-Benz Hackathon")
    st.divider()
    st.markdown(f"**Backend:** `{BACKEND_URL}`")
    st.markdown(f"**Endpoint:** `/v1/flow-dashboard`")
    if st.button("🔄 Actualizar", use_container_width=True):
        st.cache_data.clear()
        st.rerun()
    st.divider()
    days_ahead = st.slider("Días de proyección ML", min_value=7, max_value=60, value=14, step=7)

# ──────────────────────── CARGA ────────────────────────
try:
    data = load_data()
except Exception as e:
    st.error("No se pudo conectar con el backend FinOps.")
    st.code(f"cd backend && npm start", language="bash")
    st.exception(e)
    st.stop()

overview = data.get("overview", {})
consumers_raw = data.get("consumers", [])
models_raw = data.get("model_usage", [])
routing_raw = data.get("routing_usage", [])
daily_raw = data.get("daily_spend", [])
hourly_raw = data.get("hourly_spend", [])
sequence_raw = data.get("request_sequence", [])
recent_raw = data.get("recent_requests", [])
notifications_raw = data.get("notifications", [])

consumers_df = pd.DataFrame(consumers_raw) if consumers_raw else pd.DataFrame()
models_df = pd.DataFrame(models_raw) if models_raw else pd.DataFrame()
routing_df = pd.DataFrame(routing_raw) if routing_raw else pd.DataFrame()
daily_df = pd.DataFrame(daily_raw) if daily_raw else pd.DataFrame()
hourly_df = pd.DataFrame(hourly_raw) if hourly_raw else pd.DataFrame()
sequence_df = pd.DataFrame(sequence_raw) if sequence_raw else pd.DataFrame()
recent_df = pd.DataFrame(recent_raw) if recent_raw else pd.DataFrame()
notifications_df = pd.DataFrame(notifications_raw) if notifications_raw else pd.DataFrame()

if not daily_df.empty:
    daily_df["day"] = pd.to_datetime(daily_df["day"])
if not hourly_df.empty:
    hourly_df["hour"] = pd.to_datetime(hourly_df["hour"])
if not sequence_df.empty:
    sequence_df["created_at"] = pd.to_datetime(sequence_df["created_at"])
if not notifications_df.empty:
    notifications_df["created_at"] = pd.to_datetime(notifications_df["created_at"])

# ──────────────────────── HEADER ────────────────────────
st.title("📊 AI FinOps Flow Dashboard")
st.caption(f"Última actualización: {data.get('generated_at', '—')}")

# Notificación visible: los últimos avisos de presupuesto se muestran siempre
# arriba del todo, sin necesidad de entrar a ninguna pestaña.
if not notifications_df.empty:
    latest_alerts = notifications_df.head(3)
    for _, n in latest_alerts.iterrows():
        icon = {"warning": "⚠️", "critical": "🟠", "blocked": "🛑"}.get(n["level"], "🔔")
        render = st.error if n["level"] == "blocked" else (st.warning if n["level"] == "critical" else st.info)
        render(f"{icon} **[{n['level'].upper()}]** {n['message']}  \n_{n['created_at']}_")

st.divider()

# ──────────────────────── KPIs GLOBALES ────────────────────────
k1, k2, k3, k4, k5, k6 = st.columns(6)
k1.metric("Requests totales", int(overview.get("total_requests", 0)))
k2.metric("Coste acumulado", money(overview.get("current_spend_usd", 0)))
k3.metric("Presupuesto usado", pct(overview.get("budget_usage_ratio", 0)))
k4.metric("Coste medio/request", money(overview.get("avg_cost_per_request", 0)))
k5.metric("Tokens input", f"{int(overview.get('total_prompt_tokens', 0)):,}")
k6.metric("Tokens output", f"{int(overview.get('total_completion_tokens', 0)):,}")

k7, k8, k9, k10 = st.columns(4)
k7.metric("Presupuesto restante", money(overview.get("remaining_budget_usd", 0)))
k8.metric("Proyección mensual", money(overview.get("projected_monthly_spend_usd", 0)),
          help="Coste medio diario × 30")
k9.metric("Ahorro estimado (routing)", money(overview.get("total_savings_usd", 0)),
          help="Diferencia de coste frente a haber enrutado siempre al modelo más caro (mistral:7b)")
k10.metric("Presupuesto total", money(overview.get("total_monthly_budget_usd", 0)))

st.divider()

# ──────────────────────── TABS ────────────────────────
tab_overview, tab_teams, tab_models, tab_routing, tab_ml, tab_audit, tab_alerts = st.tabs([
    "🌐 Global", "👥 Equipos", "🤖 Modelos", "🔀 Routing", "🔮 Proyección ML", "📋 Auditoría", "🔔 Alertas"
])


# ═══════════════ TAB: GLOBAL ═══════════════
with tab_overview:
    col_l, col_r = st.columns([1, 1])

    with col_l:
        st.markdown("#### Distribución del gasto por equipo")
        if not consumers_df.empty:
            fig = px.pie(
                consumers_df, values="current_spend_usd", names="name",
                hole=0.5,
                color_discrete_sequence=px.colors.qualitative.Set2
            )
            fig.update_traces(textposition="outside", textinfo="percent+label")
            fig.update_layout(showlegend=False, margin=dict(t=20, b=20))
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("Sin datos aún.")

    with col_r:
        st.markdown("#### Presupuesto mensual: gastado vs restante (por equipo)")
        if not consumers_df.empty:
            fig = go.Figure()
            fig.add_trace(go.Bar(
                name="Gastado", x=consumers_df["name"],
                y=consumers_df["current_spend_usd"],
                marker_color="#D0021B"
            ))
            fig.add_trace(go.Bar(
                name="Restante", x=consumers_df["name"],
                y=consumers_df["remaining_budget_usd"],
                marker_color="#00A651"
            ))
            fig.update_layout(barmode="stack", margin=dict(t=20, b=20), legend=dict(orientation="h"))
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("Sin datos aún.")

    if not daily_df.empty:
        st.markdown("#### Coste diario acumulado")
        fig = px.area(
            daily_df, x="day", y="total_cost_usd",
            labels={"day": "Fecha", "total_cost_usd": "Coste USD"},
            color_discrete_sequence=["#003DA5"]
        )
        fig.update_layout(margin=dict(t=20, b=20))
        st.plotly_chart(fig, use_container_width=True)


# ═══════════════ TAB: EQUIPOS ═══════════════
with tab_teams:
    if consumers_df.empty:
        st.info("Sin datos de equipos.")
    else:
        consumers_df["budget_pct"] = consumers_df["budget_usage_ratio"] * 100

        # Alertas
        risky = consumers_df[consumers_df["budget_usage_ratio"] >= 0.8]
        if not risky.empty:
            for _, row in risky.iterrows():
                st.warning(f"⚠️ **{row['name']}** ha consumido el {row['budget_pct']:.1f}% de su presupuesto.")

        st.markdown("#### Gasto acumulado por equipo")
        fig = px.bar(
            consumers_df.sort_values("current_spend_usd", ascending=True),
            x="current_spend_usd", y="name", orientation="h",
            color="budget_pct",
            color_continuous_scale=["#00A651", "#FFD700", "#D0021B"],
            range_color=[0, 100],
            labels={"current_spend_usd": "USD gastado", "name": "Equipo", "budget_pct": "% presupuesto"},
            text="current_spend_usd"
        )
        fig.update_traces(texttemplate="$%{text:.6f}", textposition="outside")
        fig.update_layout(coloraxis_colorbar=dict(title="% uso"), margin=dict(t=20, b=20))
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### Tokens consumidos por equipo")
        fig = go.Figure()
        fig.add_trace(go.Bar(name="Tokens Input", x=consumers_df["name"], y=consumers_df["prompt_tokens"], marker_color="#003DA5"))
        fig.add_trace(go.Bar(name="Tokens Output", x=consumers_df["name"], y=consumers_df["completion_tokens"], marker_color="#00A651"))
        fig.update_layout(barmode="group", margin=dict(t=20, b=20), legend=dict(orientation="h"))
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### Detalle completo por equipo")
        display_cols = ["name", "department", "requests_count", "prompt_tokens",
                        "completion_tokens", "current_spend_usd", "monthly_budget_usd",
                        "remaining_budget_usd", "budget_pct"]
        st.dataframe(
            consumers_df[display_cols].rename(columns={
                "name": "Equipo", "department": "Depto", "requests_count": "Requests",
                "prompt_tokens": "Tokens In", "completion_tokens": "Tokens Out",
                "current_spend_usd": "Gastado $", "monthly_budget_usd": "Presupuesto $",
                "remaining_budget_usd": "Restante $", "budget_pct": "% Uso"
            }),
            use_container_width=True, hide_index=True
        )


# ═══════════════ TAB: MODELOS ═══════════════
with tab_models:
    if models_df.empty:
        st.info("Sin datos de modelos.")
    else:
        col1, col2 = st.columns(2)

        with col1:
            st.markdown("#### Requests por modelo")
            fig = px.pie(
                models_df, values="requests_count", names="model_id",
                color="model_id",
                color_discrete_map=COLORS,
                hole=0.4
            )
            fig.update_traces(textinfo="percent+label")
            fig.update_layout(showlegend=False, margin=dict(t=20, b=20))
            st.plotly_chart(fig, use_container_width=True)

        with col2:
            st.markdown("#### Coste total por modelo")
            fig = px.bar(
                models_df, x="model_id", y="total_cost_usd",
                color="model_id", color_discrete_map=COLORS,
                labels={"model_id": "Modelo", "total_cost_usd": "Coste USD"},
                text="total_cost_usd"
            )
            fig.update_traces(texttemplate="$%{text:.8f}", textposition="outside")
            fig.update_layout(showlegend=False, margin=dict(t=20, b=20))
            st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### Tokens consumidos por modelo")
        fig = go.Figure()
        fig.add_trace(go.Bar(
            name="Tokens Input", x=models_df["model_id"], y=models_df["prompt_tokens"],
            marker_color=["#003DA5", "#00A651", "#FF6B00"][:len(models_df)]
        ))
        fig.add_trace(go.Bar(
            name="Tokens Output", x=models_df["model_id"], y=models_df["completion_tokens"],
            marker_color=["#5B8DEF", "#4DCFA4", "#FFAA66"][:len(models_df)]
        ))
        fig.update_layout(barmode="group", margin=dict(t=20, b=20), legend=dict(orientation="h"))
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### Coste por token según modelo (in vs out)")
        pricing_data = [
            {"Modelo": "llama3.2:3b", "In ($/1M)": 0.06, "Out ($/1M)": 0.06, "Tipo": "Barato"},
            {"Modelo": "mistral:7b", "In ($/1M)": 0.24, "Out ($/1M)": 0.24, "Tipo": "Calidad"},
            {"Modelo": "llama-3.1-8b-instant", "In ($/1M)": 0.05, "Out ($/1M)": 0.08, "Tipo": "Cloud"},
        ]
        pricing_df = pd.DataFrame(pricing_data)
        fig = px.scatter(
            pricing_df, x="In ($/1M)", y="Out ($/1M)", text="Modelo",
            color="Tipo", size=[20, 20, 20],
            color_discrete_map={"Barato": "#00A651", "Calidad": "#003DA5", "Cloud": "#FF6B00"}
        )
        fig.update_traces(textposition="top center")
        fig.update_layout(margin=dict(t=20, b=20))
        st.plotly_chart(fig, use_container_width=True)


# ═══════════════ TAB: ROUTING ═══════════════
with tab_routing:
    st.markdown("""
    Las reglas de routing son los **criterios explícitos de ahorro/calidad**
    que el proxy aplica automáticamente. Cada método tiene un propósito FinOps diferente.
    """)

    routing_explanations = {
        "default_low_cost": "Tarea simple → llama3.2:3b (ahorro máximo)",
        "quality_reasoning_keywords": "Razonamiento/código → mistral:7b (calidad)",
        "cost_guardrail_long_prompt": "Prompt largo → llama3.2:3b (guardrail de tokens)",
        "budget_guardrail_critical": "Presupuesto >90% → llama3.2:3b (protección presupuesto)",
        "manual_request_honored": "Cliente eligió modelo explícitamente",
        "fallback_invalid_requested_model": "Modelo no soportado → fallback a llama3.2:3b",
    }

    if routing_df.empty:
        st.info("Sin decisiones de routing registradas aún.")
    else:
        col1, col2 = st.columns(2)

        with col1:
            st.markdown("#### Requests por regla de routing")
            fig = px.pie(
                routing_df, values="requests_count", names="routing_method",
                color="routing_method", color_discrete_map=ROUTING_COLORS, hole=0.45
            )
            fig.update_traces(textinfo="percent+label")
            fig.update_layout(showlegend=False, margin=dict(t=20, b=20))
            st.plotly_chart(fig, use_container_width=True)

        with col2:
            st.markdown("#### Coste generado por regla")
            fig = px.bar(
                routing_df.sort_values("total_cost_usd", ascending=True),
                x="total_cost_usd", y="routing_method", orientation="h",
                color="routing_method", color_discrete_map=ROUTING_COLORS,
                labels={"routing_method": "Regla", "total_cost_usd": "Coste USD"},
                text="total_cost_usd"
            )
            fig.update_traces(texttemplate="$%{text:.8f}", textposition="outside")
            fig.update_layout(showlegend=False, margin=dict(t=20, b=20))
            st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### ¿Qué hace cada regla y cuánto ha ahorrado?")
        for _, row in routing_df.iterrows():
            method = row["routing_method"]
            explanation = routing_explanations.get(method, method)
            savings = row.get("total_savings_usd", 0)
            savings_txt = f" · 💰 ahorro estimado {money(savings)}" if savings else ""
            st.markdown(
                f"- **`{method}`** ({int(row['requests_count'])} req · {money(row['total_cost_usd'])}{savings_txt}) "
                f"— {explanation}"
            )


# ═══════════════ TAB: PROYECCIÓN ML ═══════════════
with tab_ml:
    st.markdown("### Proyección predictiva de tokens y coste")

    # ── 1) Proyección INMEDIATA por solicitud (siempre disponible desde la 2ª petición) ──
    st.markdown("#### 🔴 En vivo: proyección por solicitud")
    st.info(
        "Regresión (lineal/polinómica según nº de muestras, scikit-learn) sobre "
        "**cada llamada auditada**, sin depender de días de histórico. "
        "Ideal para la demo en vivo: manda un par de mensajes en el chat y la curva se actualiza aquí."
    )

    if sequence_df.empty or len(sequence_df) < 2:
        st.warning(
            "Necesitas al menos **2 peticiones** registradas en `audit_logs` para entrenar esta proyección. "
            "Manda 2 mensajes desde el chat del frontend y pulsa '🔄 Actualizar'."
        )
    else:
        seq_steps = st.slider("Nº de solicitudes futuras a proyectar", min_value=5, max_value=100, value=20, step=5)
        seq = sequence_df.copy().reset_index(drop=True)
        seq["total_tokens"] = seq["prompt_tokens"] + seq["completion_tokens"]
        seq["cumulative_cost_usd"] = seq["total_cost_usd"].cumsum()

        future_seq = predict_sequence(sequence_df, steps_ahead=seq_steps)

        col1, col2 = st.columns(2)
        with col1:
            st.markdown("##### Coste acumulado: histórico + proyección")
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=seq["id"], y=seq["cumulative_cost_usd"],
                mode="lines+markers", name="Histórico",
                line=dict(color="#00A651", width=2)
            ))
            if not future_seq.empty:
                fig.add_trace(go.Scatter(
                    x=future_seq["request_idx"], y=future_seq["cumulative_cost_pred"],
                    mode="lines+markers", name="Proyección ML",
                    line=dict(color="#D0021B", width=2, dash="dash"),
                    marker=dict(symbol="diamond")
                ))
            fig.update_layout(xaxis_title="Nº de solicitud", yaxis_title="Coste acumulado USD",
                               legend=dict(orientation="h"), margin=dict(t=20, b=20))
            st.plotly_chart(fig, use_container_width=True)

        with col2:
            st.markdown("##### Tokens por solicitud: tendencia")
            fig2 = go.Figure()
            fig2.add_trace(go.Scatter(
                x=seq["id"], y=seq["total_tokens"],
                mode="lines+markers", name="Histórico",
                line=dict(color="#003DA5", width=2)
            ))
            if not future_seq.empty:
                fig2.add_trace(go.Scatter(
                    x=future_seq["request_idx"], y=future_seq["tokens_pred"],
                    mode="lines+markers", name="Proyección ML",
                    line=dict(color="#FF6B00", width=2, dash="dash"),
                    marker=dict(symbol="diamond")
                ))
            fig2.update_layout(xaxis_title="Nº de solicitud", yaxis_title="Tokens",
                                legend=dict(orientation="h"), margin=dict(t=20, b=20))
            st.plotly_chart(fig2, use_container_width=True)

        if not future_seq.empty:
            next_cost = future_seq["cumulative_cost_pred"].iloc[-1] - seq["cumulative_cost_usd"].iloc[-1]
            st.success(
                f"📈 Con la tendencia actual, las próximas **{seq_steps} solicitudes** añadirían "
                f"aprox. **{money(max(next_cost, 0))}** de coste adicional."
            )

    st.divider()

    # ── 2) Proyección temporal (por hora / por día) cuando ya hay suficiente histórico ──
    st.markdown("#### 🕒 Proyección temporal (tendencia de uso por fecha)")

    time_df, time_col, time_label = pd.DataFrame(), None, None
    if not daily_df.empty and daily_df["day"].nunique() >= 2:
        time_df, time_col, time_label = daily_df, "day", "día"
    elif not hourly_df.empty and hourly_df["hour"].nunique() >= 2:
        time_df, time_col, time_label = hourly_df, "hour", "hora"

    if time_df.empty:
        st.warning(
            "Todavía toda la actividad está concentrada en el mismo tramo horario. "
            "En cuanto haya actividad en 2+ horas o 2+ días distintos, aquí aparecerá la "
            "proyección de tendencia temporal (usa mientras la proyección por solicitud de arriba)."
        )
    else:
        st.caption(f"Granularidad detectada automáticamente: por **{time_label}** "
                   f"({time_df[time_col].nunique()} puntos de histórico).")
        future_df = predict_future(time_df.rename(columns={time_col: "day"}), days_ahead=days_ahead)

        if not future_df.empty:
            time_df = time_df.copy()
            time_df["total_tokens"] = time_df["prompt_tokens"] + time_df["completion_tokens"]

            colA, colB = st.columns(2)
            with colA:
                fig3 = go.Figure()
                fig3.add_trace(go.Scatter(
                    x=time_df[time_col], y=time_df["total_tokens"],
                    mode="lines+markers", name="Histórico", line=dict(color="#003DA5", width=2)
                ))
                fig3.add_trace(go.Scatter(
                    x=future_df["day"], y=future_df["tokens_pred"],
                    mode="lines+markers", name="Proyección ML",
                    line=dict(color="#FF6B00", width=2, dash="dash"), marker=dict(symbol="diamond")
                ))
                fig3.update_layout(xaxis_title=time_label.capitalize(), yaxis_title="Tokens",
                                    legend=dict(orientation="h"), margin=dict(t=20, b=20))
                st.plotly_chart(fig3, use_container_width=True)

            with colB:
                fig4 = go.Figure()
                fig4.add_trace(go.Scatter(
                    x=time_df[time_col], y=time_df["total_cost_usd"],
                    mode="lines+markers", name="Histórico", line=dict(color="#00A651", width=2)
                ))
                fig4.add_trace(go.Scatter(
                    x=future_df["day"], y=future_df["cost_pred"],
                    mode="lines+markers", name="Proyección ML",
                    line=dict(color="#D0021B", width=2, dash="dash"), marker=dict(symbol="diamond")
                ))
                fig4.update_layout(xaxis_title=time_label.capitalize(), yaxis_title="Coste USD",
                                    legend=dict(orientation="h"), margin=dict(t=20, b=20))
                st.plotly_chart(fig4, use_container_width=True)

            st.markdown(f"##### Tabla de proyección por {time_label}")
            future_display = future_df.rename(columns={
                "day": time_label.capitalize(), "tokens_pred": "Tokens estimados", "cost_pred": "Coste estimado $"
            })
            future_display["Tokens estimados"] = future_display["Tokens estimados"].astype(int)
            st.dataframe(future_display, use_container_width=True, hide_index=True)

    st.divider()

    # ── 3) Proyección mensual por equipo (siempre disponible con datos actuales) ──
    st.markdown("#### 👥 Proyección mensual estimada por equipo")
    if not consumers_df.empty and overview.get("current_spend_usd", 0) > 0:
        days_elapsed = max(daily_df["day"].nunique() if not daily_df.empty else 1, 1)
        avg_daily = overview.get("total_cost_usd", 0) / days_elapsed
        proj_rows = []
        for _, row in consumers_df.iterrows():
            share = (row["current_spend_usd"] / max(float(overview.get("current_spend_usd", 1)), 1e-10))
            proj_rows.append({
                "Equipo": row["name"],
                "Gastado actual $": row["current_spend_usd"],
                "Proyección 30d $": avg_daily * 30 * share,
                "Presupuesto $": row["monthly_budget_usd"],
            })
        proj_df = pd.DataFrame(proj_rows)

        fig5 = go.Figure()
        fig5.add_trace(go.Bar(name="Gastado actual", x=proj_df["Equipo"], y=proj_df["Gastado actual $"], marker_color="#003DA5"))
        fig5.add_trace(go.Bar(name="Proyección 30 días", x=proj_df["Equipo"], y=proj_df["Proyección 30d $"], marker_color="#FF6B00", opacity=0.7))
        fig5.add_trace(go.Scatter(
            name="Límite presupuesto", x=proj_df["Equipo"], y=proj_df["Presupuesto $"],
            mode="markers", marker=dict(symbol="line-ew-open", size=20, color="#D0021B", line_width=2)
        ))
        fig5.update_layout(barmode="group", legend=dict(orientation="h"), margin=dict(t=20, b=20))
        st.plotly_chart(fig5, use_container_width=True)
    else:
        st.info("Sin gasto registrado todavía para proyectar por equipo.")


# ═══════════════ TAB: AUDITORÍA ═══════════════
with tab_audit:
    if recent_df.empty:
        st.info("Sin registros en audit_logs aún.")
    else:
        recent_df["created_at"] = pd.to_datetime(recent_df["created_at"])

        # Timeline de requests recientes
        st.markdown("#### Timeline de últimas llamadas auditadas")
        fig = px.scatter(
            recent_df.tail(50),
            x="created_at", y="consumer_id",
            color="target_model", color_discrete_map=COLORS,
            size="total_cost_usd",
            size_max=20,
            hover_data=["routing_method", "prompt_tokens", "completion_tokens", "total_cost_usd", "routing_reason"],
            labels={"created_at": "Timestamp", "consumer_id": "Consumidor", "target_model": "Modelo"}
        )
        fig.update_layout(margin=dict(t=20, b=20), legend=dict(orientation="h"))
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### Registro completo (qué solicitud activó qué regla y su ahorro)")
        display_cols = ["created_at", "consumer_id", "consumer_name", "department",
                        "target_model", "routing_method", "prompt_tokens",
                        "completion_tokens", "total_cost_usd", "estimated_savings_usd", "routing_reason"]
        available_cols = [c for c in display_cols if c in recent_df.columns]
        st.dataframe(
            recent_df[available_cols].sort_values("created_at", ascending=False).rename(columns={
                "created_at": "Fecha", "consumer_id": "Consumer ID", "consumer_name": "Equipo",
                "department": "Depto", "target_model": "Modelo usado", "routing_method": "Regla",
                "prompt_tokens": "Tokens In", "completion_tokens": "Tokens Out",
                "total_cost_usd": "Coste $", "estimated_savings_usd": "Ahorro estimado $",
                "routing_reason": "Motivo"
            }),
            use_container_width=True, hide_index=True
        )


# ═══════════════ TAB: ALERTAS ═══════════════
with tab_alerts:
    st.markdown("### Notificaciones de presupuesto (visibles + auditables)")
    st.caption(
        "Cada vez que un equipo cruza el 80% (aviso), 90% (crítico) o 100% (bloqueo) de su presupuesto, "
        "el proxy registra aquí la alerta, la muestra en la UI del chat (banner) y —si se configuró "
        "`FINOPS_ALERT_WEBHOOK_URL`— la reenvía a un canal externo (Slack/Teams/email)."
    )

    if notifications_df.empty:
        st.info("Sin alertas generadas todavía. Se disparan automáticamente al superar el 80% del presupuesto.")
    else:
        level_counts = notifications_df["level"].value_counts()
        c1, c2, c3 = st.columns(3)
        c1.metric("⚠️ Avisos (80%)", int(level_counts.get("warning", 0)))
        c2.metric("🟠 Críticos (90%)", int(level_counts.get("critical", 0)))
        c3.metric("🛑 Bloqueos (100%)", int(level_counts.get("blocked", 0)))

        fig = px.bar(
            notifications_df.groupby("level").size().reset_index(name="count"),
            x="level", y="count", color="level",
            color_discrete_map={"warning": "#FFC107", "critical": "#FF6B00", "blocked": "#D0021B"},
            labels={"level": "Nivel", "count": "Nº de alertas"}
        )
        fig.update_layout(showlegend=False, margin=dict(t=20, b=20))
        st.plotly_chart(fig, use_container_width=True)

        st.markdown("#### Historial de alertas")
        st.dataframe(
            notifications_df[["created_at", "level", "consumer_name", "message", "channel"]].rename(columns={
                "created_at": "Fecha", "level": "Nivel", "consumer_name": "Equipo",
                "message": "Mensaje", "channel": "Canal"
            }),
            use_container_width=True, hide_index=True
        )

st.divider()
st.caption("AI FinOps Proxy · Mercedes-Benz Hackathon · Dashboard v2 con ML predictivo, alertas y auditoría de ahorro")
