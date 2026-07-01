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


def predict_future(daily_df: pd.DataFrame, days_ahead: int = 14, degree: int = 2):
    """
    Ajusta un modelo de regresión polinómica (grado 2) sobre los datos diarios
    de tokens para proyectar los próximos `days_ahead` días.
    Retorna un DataFrame con las columnas day, tokens_pred, cost_pred.
    """
    if len(daily_df) < 3:
        return pd.DataFrame()

    df = daily_df.copy().sort_values("day").reset_index(drop=True)
    df["day_num"] = np.arange(len(df))
    df["total_tokens"] = df["prompt_tokens"] + df["completion_tokens"]

    X = df[["day_num"]].values
    y_tokens = df["total_tokens"].values
    y_cost = df["total_cost_usd"].values

    poly = PolynomialFeatures(degree=degree, include_bias=False)
    X_poly = poly.fit_transform(X)

    model_tokens = LinearRegression().fit(X_poly, y_tokens)
    model_cost = LinearRegression().fit(X_poly, y_cost)

    last_day = df["day"].iloc[-1]
    future_nums = np.arange(len(df), len(df) + days_ahead).reshape(-1, 1)
    future_poly = poly.transform(future_nums)

    future_days = [last_day + timedelta(days=i + 1) for i in range(days_ahead)]
    tokens_pred = np.maximum(model_tokens.predict(future_poly), 0)
    cost_pred = np.maximum(model_cost.predict(future_poly), 0)

    return pd.DataFrame({"day": future_days, "tokens_pred": tokens_pred, "cost_pred": cost_pred})


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
recent_raw = data.get("recent_requests", [])

consumers_df = pd.DataFrame(consumers_raw) if consumers_raw else pd.DataFrame()
models_df = pd.DataFrame(models_raw) if models_raw else pd.DataFrame()
routing_df = pd.DataFrame(routing_raw) if routing_raw else pd.DataFrame()
daily_df = pd.DataFrame(daily_raw) if daily_raw else pd.DataFrame()
recent_df = pd.DataFrame(recent_raw) if recent_raw else pd.DataFrame()

if not daily_df.empty:
    daily_df["day"] = pd.to_datetime(daily_df["day"])

# ──────────────────────── HEADER ────────────────────────
st.title("📊 AI FinOps Flow Dashboard")
st.caption(f"Última actualización: {data.get('generated_at', '—')}")
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
k9.metric("Coste evitable estimado", money(overview.get("estimated_avoidable_cost_usd", 0)),
          help="Si se hubiera usado llama3.2:3b en vez de Mistral")
k10.metric("Presupuesto total", money(overview.get("total_monthly_budget_usd", 0)))

st.divider()

# ──────────────────────── TABS ────────────────────────
tab_overview, tab_teams, tab_models, tab_routing, tab_ml, tab_audit = st.tabs([
    "🌐 Global", "👥 Equipos", "🤖 Modelos", "🔀 Routing", "🔮 Proyección ML", "📋 Auditoría"
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

        st.markdown("#### ¿Qué hace cada regla?")
        for _, row in routing_df.iterrows():
            method = row["routing_method"]
            explanation = routing_explanations.get(method, method)
            st.markdown(
                f"- **`{method}`** ({int(row['requests_count'])} req · {money(row['total_cost_usd'])}) "
                f"— {explanation}"
            )


# ═══════════════ TAB: PROYECCIÓN ML ═══════════════
with tab_ml:
    st.markdown("### Proyección predictiva de tokens y coste")
    st.info(
        "Se usa **regresión polinómica de grado 2** (scikit-learn) "
        "entrenada sobre el histórico de uso diario para proyectar los próximos "
        f"**{days_ahead} días**. Con más datos el modelo gana precisión."
    )

    if daily_df.empty or len(daily_df) < 3:
        st.warning(
            "Se necesitan al menos 3 días de histórico para entrenar el modelo predictivo. "
            "Sigue usando el proxy y vuelve aquí."
        )
    else:
        future_df = predict_future(daily_df, days_ahead=days_ahead)

        if future_df.empty:
            st.warning("No fue posible generar la proyección.")
        else:
            daily_df["total_tokens"] = daily_df["prompt_tokens"] + daily_df["completion_tokens"]
            daily_df["type"] = "Histórico"
            future_df["total_tokens"] = future_df["tokens_pred"]
            future_df["total_cost_usd"] = future_df["cost_pred"]
            future_df["type"] = "Proyección ML"

            # ── Gráfica de tokens ──
            st.markdown("#### Tokens totales: histórico + proyección")
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=daily_df["day"], y=daily_df["total_tokens"],
                mode="lines+markers", name="Histórico",
                line=dict(color="#003DA5", width=2),
                marker=dict(size=6)
            ))
            fig.add_trace(go.Scatter(
                x=future_df["day"], y=future_df["total_tokens"],
                mode="lines+markers", name="Proyección ML",
                line=dict(color="#FF6B00", width=2, dash="dash"),
                marker=dict(size=6, symbol="diamond")
            ))
            fig.update_layout(
                xaxis_title="Fecha", yaxis_title="Tokens",
                legend=dict(orientation="h"),
                margin=dict(t=20, b=20)
            )
            st.plotly_chart(fig, use_container_width=True)

            # ── Gráfica de coste ──
            st.markdown("#### Coste USD: histórico + proyección")
            fig2 = go.Figure()
            fig2.add_trace(go.Scatter(
                x=daily_df["day"], y=daily_df["total_cost_usd"],
                mode="lines+markers", name="Histórico",
                line=dict(color="#00A651", width=2),
                marker=dict(size=6)
            ))
            fig2.add_trace(go.Scatter(
                x=future_df["day"], y=future_df["total_cost_usd"],
                mode="lines+markers", name="Proyección ML",
                line=dict(color="#D0021B", width=2, dash="dash"),
                marker=dict(size=6, symbol="diamond")
            ))
            fig2.update_layout(
                xaxis_title="Fecha", yaxis_title="Coste USD",
                legend=dict(orientation="h"),
                margin=dict(t=20, b=20)
            )
            st.plotly_chart(fig2, use_container_width=True)

            # ── Proyección por equipo ──
            st.markdown("#### Proyección mensual estimada por equipo")
            if not consumers_df.empty:
                avg_daily = overview.get("total_cost_usd", 0) / max(len(daily_df), 1)
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

                fig3 = go.Figure()
                fig3.add_trace(go.Bar(
                    name="Gastado actual",
                    x=proj_df["Equipo"], y=proj_df["Gastado actual $"],
                    marker_color="#003DA5"
                ))
                fig3.add_trace(go.Bar(
                    name="Proyección 30 días",
                    x=proj_df["Equipo"], y=proj_df["Proyección 30d $"],
                    marker_color="#FF6B00",
                    opacity=0.7
                ))
                fig3.add_trace(go.Scatter(
                    name="Límite presupuesto",
                    x=proj_df["Equipo"], y=proj_df["Presupuesto $"],
                    mode="markers", marker=dict(symbol="line-ew-open", size=20, color="#D0021B", line_width=2)
                ))
                fig3.update_layout(
                    barmode="group",
                    legend=dict(orientation="h"),
                    margin=dict(t=20, b=20)
                )
                st.plotly_chart(fig3, use_container_width=True)

            # ── Tabla resumen ──
            st.markdown("#### Tabla de proyección diaria")
            future_display = future_df[["day", "total_tokens", "total_cost_usd"]].copy()
            future_display.columns = ["Fecha", "Tokens estimados", "Coste estimado $"]
            future_display["Tokens estimados"] = future_display["Tokens estimados"].astype(int)
            st.dataframe(future_display, use_container_width=True, hide_index=True)


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

        st.markdown("#### Registro completo")
        display_cols = ["created_at", "consumer_id", "consumer_name", "department",
                        "target_model", "routing_method", "prompt_tokens",
                        "completion_tokens", "total_cost_usd", "routing_reason"]
        available_cols = [c for c in display_cols if c in recent_df.columns]
        st.dataframe(
            recent_df[available_cols].sort_values("created_at", ascending=False),
            use_container_width=True, hide_index=True
        )

st.divider()
st.caption("AI FinOps Proxy · Mercedes-Benz Hackathon · Dashboard v2 con ML predictivo")
