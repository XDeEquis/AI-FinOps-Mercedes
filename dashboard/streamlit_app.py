"""
AI FinOps Dashboard
Visibilidad de costes, control de presupuesto y proyección predictiva
para el proxy de IA (Mercedes-Benz Hackathon).
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

# ──────────────────────── PALETA DE COLOR (única fuente de verdad) ────────────────────────
# Paleta reducida y de bajo contraste cromático (evita el "arcoíris") para que
# el color aporte información y no ruido. El texto/las etiquetas siempre
# acompañan al color, nunca es la única señal (accesibilidad).
COLOR = {
    "primary": "#1F2A44",
    "accent": "#3B6EA5",
    "success": "#2E7D4F",
    "warning": "#B8860B",
    "critical": "#C1440E",
    "danger": "#B00020",
    "neutral": "#7A8699",
    "bg_card": "rgba(255,255,255,0.035)",
    "border": "rgba(255,255,255,0.09)",
}

MODEL_COLORS = {
    "llama3.2:3b": COLOR["accent"],
    "mistral:7b": COLOR["primary"],
    "llama-3.1-8b-instant": COLOR["warning"],
    "default": COLOR["neutral"],
}

ROUTING_COLORS = {
    "default_low_cost": COLOR["success"],
    "quality_reasoning_keywords": COLOR["accent"],
    "cost_guardrail_long_prompt": COLOR["warning"],
    "budget_guardrail_critical": COLOR["danger"],
    "manual_request_honored": COLOR["neutral"],
    "fallback_invalid_requested_model": COLOR["neutral"],
}

ROUTING_LABELS = {
    "default_low_cost": "Tarea simple -> modelo económico",
    "quality_reasoning_keywords": "Razonamiento/código -> modelo de calidad",
    "cost_guardrail_long_prompt": "Prompt largo -> modelo económico (guardrail)",
    "budget_guardrail_critical": "Presupuesto crítico (>90%) -> modelo económico",
    "manual_request_honored": "Modelo solicitado explícitamente por el cliente",
    "fallback_invalid_requested_model": "Modelo no soportado -> fallback económico",
}

ALERT_COLORS = {"warning": COLOR["warning"], "critical": COLOR["critical"], "blocked": COLOR["danger"]}
ALERT_LABELS = {"warning": "Aviso (80%)", "critical": "Crítico (90%)", "blocked": "Bloqueado (100%)"}

st.set_page_config(page_title="AI FinOps Dashboard", page_icon=None, layout="wide")

st.markdown("""
<style>
    #MainMenu, footer {visibility: hidden;}
    .block-container {padding-top: 2.2rem; max-width: 1280px;}
    h1, h2, h3, h4 {font-weight: 600; letter-spacing: -0.01em;}
    [data-testid="stMetric"] {
        background: rgba(255,255,255,0.035);
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 10px;
        padding: 14px 18px;
    }
    [data-testid="stMetricLabel"] {font-size: 0.82rem; opacity: 0.75;}
    .section-caption {font-size: 0.85rem; opacity: 0.65; margin-top: -6px; margin-bottom: 18px;}
    div[data-testid="stVerticalBlockBorderWrapper"] {border-radius: 10px;}
</style>
""", unsafe_allow_html=True)


@st.cache_data(ttl=10)
def load_data() -> dict:
    r = requests.get(DASHBOARD_ENDPOINT, timeout=10)
    r.raise_for_status()
    return r.json()


def money(v) -> str:
    v = float(v or 0)
    if v == 0:
        return "$0.00"
    return f"${v:,.4f}" if v >= 0.01 else f"${v:,.8f}"


def pct(v) -> str:
    v = float(v or 0) * 100
    return f"{v:.4f}%" if 0 < v < 0.1 else f"{v:.1f}%"


def chart_layout(fig, height=360):
    fig.update_layout(
        margin=dict(t=30, b=30, l=10, r=10),
        height=height,
        legend=dict(orientation="h", yanchor="bottom", y=1.02),
        font=dict(size=13),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    return fig


def fit_predict(y: np.ndarray, steps: int, max_degree: int = 2) -> np.ndarray:
    """
    Regresión polinómica cuyo grado se adapta al número de muestras (con 2
    puntos usa una recta) para poder mostrar una proyección desde el primer
    momento de una demo en vivo, sin depender de varios días de histórico.
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
    preds = model.predict(poly.transform(X_future))
    return np.maximum(preds, 0)


def predict_future(time_df: pd.DataFrame, periods_ahead: int, unit: str = "day"):
    if len(time_df) < 2:
        return pd.DataFrame()

    df = time_df.copy().sort_values("period").reset_index(drop=True)
    df["total_tokens"] = df["prompt_tokens"] + df["completion_tokens"]

    tokens_pred = fit_predict(df["total_tokens"].values, periods_ahead)
    cost_pred = fit_predict(df["total_cost_usd"].values, periods_ahead)

    last = df["period"].iloc[-1]
    delta = timedelta(hours=1) if unit == "hour" else timedelta(days=1)
    future_periods = [last + delta * (i + 1) for i in range(periods_ahead)]

    return pd.DataFrame({"period": future_periods, "tokens_pred": tokens_pred, "cost_pred": cost_pred})


def predict_sequence(seq_df: pd.DataFrame, steps_ahead: int = 20):
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
    st.markdown("### AI FinOps")
    st.caption("Mercedes-Benz Hackathon")
    st.divider()
    if st.button("Actualizar datos", use_container_width=True):
        st.cache_data.clear()
        st.rerun()
    st.divider()
    horizon = st.slider("Horizonte de proyección (días)", min_value=7, max_value=60, value=14, step=7)
    st.caption(f"Backend: {BACKEND_URL}")

# ──────────────────────── CARGA ────────────────────────
try:
    data = load_data()
except Exception as e:
    st.error("No se pudo conectar con el backend del proxy FinOps.")
    st.code("cd backend && npm start", language="bash")
    st.exception(e)
    st.stop()

overview = data.get("overview", {})
consumers_raw = data.get("consumers", [])
user_usage_raw = data.get("user_usage", [])
models_raw = data.get("model_usage", [])
routing_raw = data.get("routing_usage", [])
daily_raw = data.get("daily_spend", [])
hourly_raw = data.get("hourly_spend", [])
sequence_raw = data.get("request_sequence", [])
recent_raw = data.get("recent_requests", [])
notifications_raw = data.get("notifications", [])

consumers_df = pd.DataFrame(consumers_raw) if consumers_raw else pd.DataFrame()
user_usage_df = pd.DataFrame(user_usage_raw) if user_usage_raw else pd.DataFrame()
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
if not recent_df.empty:
    recent_df["created_at"] = pd.to_datetime(recent_df["created_at"])

# ──────────────────────── HEADER ────────────────────────
st.title("AI FinOps Dashboard")
st.caption(f"Última actualización: {data.get('generated_at', '—')}")

if not notifications_df.empty:
    for _, n in notifications_df.head(3).iterrows():
        label = ALERT_LABELS.get(n["level"], n["level"])
        render = st.error if n["level"] == "blocked" else (st.warning if n["level"] == "critical" else st.info)
        render(f"**{label} · {n['consumer_name']}** — {n['message']}")

st.divider()

# ──────────────────────── KPIs GLOBALES ────────────────────────
k1, k2, k3, k4 = st.columns(4)
k1.metric("Solicitudes totales", int(overview.get("total_requests", 0)))
k2.metric("Coste acumulado", money(overview.get("current_spend_usd", 0)))
k3.metric("Presupuesto usado", pct(overview.get("budget_usage_ratio", 0)))
k4.metric("Ahorro por routing", money(overview.get("total_savings_usd", 0)))

k5, k6, k7, k8 = st.columns(4)
k5.metric("Presupuesto restante", money(overview.get("remaining_budget_usd", 0)))
k6.metric("Presupuesto total", money(overview.get("total_monthly_budget_usd", 0)))
k7.metric("Coste medio / solicitud", money(overview.get("avg_cost_per_request", 0)))
k8.metric("Proyección mensual", money(overview.get("projected_monthly_spend_usd", 0)), help="Coste medio diario multiplicado por 30")

st.divider()

tab_overview, tab_teams, tab_models, tab_forecast, tab_audit, tab_alerts = st.tabs([
    "Resumen", "Equipos", "Modelos y routing", "Proyección", "Auditoría", "Alertas"
])


# ═══════════════ RESUMEN ═══════════════
with tab_overview:
    col_l, col_r = st.columns(2)

    with col_l:
        st.markdown("##### Gasto por equipo")
        if consumers_df.empty:
            st.info("Todavía no hay gasto registrado.")
        else:
            fig = px.bar(
                consumers_df.sort_values("current_spend_usd", ascending=True),
                x="current_spend_usd", y="name", orientation="h",
                color_discrete_sequence=[COLOR["accent"]],
                labels={"current_spend_usd": "Coste USD", "name": ""},
                text="current_spend_usd"
            )
            fig.update_traces(texttemplate="$%{text:.6f}", textposition="outside", marker_line_width=0)
            fig.update_layout(showlegend=False)
            st.plotly_chart(chart_layout(fig, 280), use_container_width=True)
            st.caption("Coste acumulado por equipo en el periodo actual, de menor a mayor gasto.")

    with col_r:
        st.markdown("##### Presupuesto: consumido vs. disponible")
        if consumers_df.empty:
            st.info("Sin datos de equipos.")
        else:
            fig = go.Figure()
            fig.add_trace(go.Bar(name="Consumido", x=consumers_df["name"], y=consumers_df["current_spend_usd"], marker_color=COLOR["critical"]))
            fig.add_trace(go.Bar(name="Disponible", x=consumers_df["name"], y=consumers_df["remaining_budget_usd"], marker_color=COLOR["success"]))
            fig.update_layout(barmode="stack")
            st.plotly_chart(chart_layout(fig, 280), use_container_width=True)
            st.caption("Cada barra representa el 100% del presupuesto mensual asignado a ese equipo.")

    if not daily_df.empty and daily_df["day"].nunique() >= 2:
        st.markdown("##### Evolución diaria del coste")
        fig = px.area(daily_df, x="day", y="total_cost_usd",
                       labels={"day": "Fecha", "total_cost_usd": "Coste USD"},
                       color_discrete_sequence=[COLOR["accent"]])
        st.plotly_chart(chart_layout(fig, 300), use_container_width=True)
        st.caption("Suma de coste generado por todas las solicitudes agrupadas por día.")


# ═══════════════ EQUIPOS ═══════════════
with tab_teams:
    if consumers_df.empty:
        st.info("Sin datos de equipos.")
    else:
        consumers_df["budget_pct"] = consumers_df["budget_usage_ratio"] * 100

        risky = consumers_df[consumers_df["budget_usage_ratio"] >= 0.8]
        if not risky.empty:
            for _, row in risky.iterrows():
                st.warning(f"**{row['name']}** ha consumido el {row['budget_pct']:.1f}% de su presupuesto mensual.")

        st.markdown("##### Detalle por equipo")
        display_cols = ["name", "department", "requests_count", "prompt_tokens",
                        "completion_tokens", "current_spend_usd", "monthly_budget_usd",
                        "remaining_budget_usd", "budget_pct", "savings_usd"]
        st.dataframe(
            consumers_df[display_cols].rename(columns={
                "name": "Equipo", "department": "Departamento", "requests_count": "Solicitudes",
                "prompt_tokens": "Tokens entrada", "completion_tokens": "Tokens salida",
                "current_spend_usd": "Gastado (USD)", "monthly_budget_usd": "Presupuesto (USD)",
                "remaining_budget_usd": "Restante (USD)", "budget_pct": "% usado",
                "savings_usd": "Ahorro (USD)"
            }),
            use_container_width=True, hide_index=True
        )

        st.divider()
        st.markdown("##### Contribución individual por persona")
        st.markdown(
            '<p class="section-caption">Desglose del gasto dentro de cada equipo, por usuario que ha enviado solicitudes desde el chat.</p>',
            unsafe_allow_html=True
        )

        if user_usage_df.empty:
            st.info("Todavía no hay solicitudes con usuario identificado.")
        else:
            team_options = sorted(user_usage_df["consumer_name"].dropna().unique().tolist())
            selected_team = st.selectbox("Equipo", team_options)
            team_users = user_usage_df[user_usage_df["consumer_name"] == selected_team].sort_values("total_cost_usd", ascending=True)

            fig = px.bar(
                team_users, x="total_cost_usd", y="user_name", orientation="h",
                color_discrete_sequence=[COLOR["primary"]],
                labels={"total_cost_usd": "Coste USD", "user_name": ""},
                text="total_cost_usd"
            )
            fig.update_traces(texttemplate="$%{text:.6f}", textposition="outside", marker_line_width=0)
            fig.update_layout(showlegend=False)
            st.plotly_chart(chart_layout(fig, max(220, 60 * len(team_users))), use_container_width=True)
            st.caption(f"Coste generado por cada persona del equipo {selected_team}.")

            st.dataframe(
                team_users[["user_name", "requests_count", "prompt_tokens", "completion_tokens", "total_cost_usd", "total_savings_usd"]]
                .rename(columns={
                    "user_name": "Usuario", "requests_count": "Solicitudes",
                    "prompt_tokens": "Tokens entrada", "completion_tokens": "Tokens salida",
                    "total_cost_usd": "Coste (USD)", "total_savings_usd": "Ahorro (USD)"
                }),
                use_container_width=True, hide_index=True
            )


# ═══════════════ MODELOS Y ROUTING ═══════════════
with tab_models:
    col1, col2 = st.columns(2)

    with col1:
        st.markdown("##### Coste por modelo")
        if models_df.empty:
            st.info("Sin datos de modelos.")
        else:
            fig = px.bar(
                models_df, x="model_id", y="total_cost_usd",
                color="model_id", color_discrete_map=MODEL_COLORS,
                labels={"model_id": "Modelo", "total_cost_usd": "Coste USD"},
                text="total_cost_usd"
            )
            fig.update_traces(texttemplate="$%{text:.6f}", textposition="outside", marker_line_width=0)
            fig.update_layout(showlegend=False)
            st.plotly_chart(chart_layout(fig, 320), use_container_width=True)
            st.caption("Coste total generado por cada modelo del catálogo.")

    with col2:
        st.markdown("##### Solicitudes por regla de routing")
        if routing_df.empty:
            st.info("Sin decisiones de routing registradas.")
        else:
            fig = px.bar(
                routing_df.sort_values("requests_count"), x="requests_count", y="routing_method",
                orientation="h", color="routing_method", color_discrete_map=ROUTING_COLORS,
                labels={"requests_count": "Solicitudes", "routing_method": ""},
                text="requests_count"
            )
            fig.update_traces(textposition="outside", marker_line_width=0)
            fig.update_layout(showlegend=False)
            st.plotly_chart(chart_layout(fig, 320), use_container_width=True)
            st.caption("Número de solicitudes que activó cada regla de enrutamiento inteligente.")

    if not models_df.empty:
        st.markdown("##### Tokens por modelo (entrada vs. salida)")
        fig = go.Figure()
        fig.add_trace(go.Bar(name="Entrada", x=models_df["model_id"], y=models_df["prompt_tokens"], marker_color=COLOR["accent"]))
        fig.add_trace(go.Bar(name="Salida", x=models_df["model_id"], y=models_df["completion_tokens"], marker_color=COLOR["neutral"]))
        fig.update_layout(barmode="group")
        st.plotly_chart(chart_layout(fig, 300), use_container_width=True)

    st.divider()
    st.markdown("##### Qué hace cada regla y cuánto ha ahorrado")
    if routing_df.empty:
        st.info("Sin decisiones de routing registradas aún.")
    else:
        for _, row in routing_df.iterrows():
            method = row["routing_method"]
            explanation = ROUTING_LABELS.get(method, method)
            savings = row.get("total_savings_usd", 0)
            savings_txt = f" · ahorro estimado {money(savings)}" if savings else ""
            st.markdown(f"- **{explanation}** — {int(row['requests_count'])} solicitudes, {money(row['total_cost_usd'])}{savings_txt}")


# ═══════════════ PROYECCIÓN ═══════════════
with tab_forecast:
    st.markdown("##### Proyección en vivo por solicitud")
    st.markdown(
        '<p class="section-caption">Regresión sobre el histórico de solicitudes auditadas: no depende de días de '
        'histórico, así que puede consultarse durante la propia demo tras un par de mensajes en el chat.</p>',
        unsafe_allow_html=True
    )

    if sequence_df.empty or len(sequence_df) < 2:
        st.info("Se necesitan al menos 2 solicitudes registradas para generar esta proyección.")
    else:
        seq_steps = st.slider("Solicitudes futuras a proyectar", min_value=5, max_value=100, value=20, step=5)
        seq = sequence_df.copy().reset_index(drop=True)
        seq["total_tokens"] = seq["prompt_tokens"] + seq["completion_tokens"]
        seq["cumulative_cost_usd"] = seq["total_cost_usd"].cumsum()
        future_seq = predict_sequence(sequence_df, steps_ahead=seq_steps)

        col1, col2 = st.columns(2)
        with col1:
            fig = go.Figure()
            fig.add_trace(go.Scatter(x=seq["id"], y=seq["cumulative_cost_usd"], mode="lines", name="Histórico", line=dict(color=COLOR["accent"], width=2)))
            if not future_seq.empty:
                fig.add_trace(go.Scatter(x=future_seq["request_idx"], y=future_seq["cumulative_cost_pred"], mode="lines", name="Proyección", line=dict(color=COLOR["critical"], width=2, dash="dash")))
            fig.update_layout(xaxis_title="Nº de solicitud", yaxis_title="Coste acumulado (USD)")
            st.plotly_chart(chart_layout(fig, 300), use_container_width=True)
            st.caption("Coste acumulado histórico y su proyección a corto plazo.")

        with col2:
            fig2 = go.Figure()
            fig2.add_trace(go.Scatter(x=seq["id"], y=seq["total_tokens"], mode="lines", name="Histórico", line=dict(color=COLOR["primary"], width=2)))
            if not future_seq.empty:
                fig2.add_trace(go.Scatter(x=future_seq["request_idx"], y=future_seq["tokens_pred"], mode="lines", name="Proyección", line=dict(color=COLOR["warning"], width=2, dash="dash")))
            fig2.update_layout(xaxis_title="Nº de solicitud", yaxis_title="Tokens")
            st.plotly_chart(chart_layout(fig2, 300), use_container_width=True)
            st.caption("Tokens consumidos por solicitud y su tendencia.")

        if not future_seq.empty:
            next_cost = max(future_seq["cumulative_cost_pred"].iloc[-1] - seq["cumulative_cost_usd"].iloc[-1], 0)
            st.info(f"Con la tendencia actual, las próximas {seq_steps} solicitudes añadirían aproximadamente {money(next_cost)} de coste adicional.")

    st.divider()
    st.markdown("##### Proyección temporal")

    time_df, unit, unit_label = pd.DataFrame(), None, None
    if not daily_df.empty and daily_df["day"].nunique() >= 2:
        time_df = daily_df.rename(columns={"day": "period"})
        unit, unit_label = "day", "día"
    elif not hourly_df.empty and hourly_df["hour"].nunique() >= 2:
        time_df = hourly_df.rename(columns={"hour": "period"})
        unit, unit_label = "hour", "hora"

    if time_df.empty:
        st.info("Se necesita actividad en al menos 2 tramos horarios o días distintos para esta vista. Usa la proyección por solicitud mientras tanto.")
    else:
        st.caption(f"Granularidad detectada automáticamente: por {unit_label} ({time_df['period'].nunique()} puntos).")
        future_df = predict_future(time_df, periods_ahead=horizon if unit == "day" else horizon * 24, unit=unit)

        if not future_df.empty:
            time_df["total_tokens"] = time_df["prompt_tokens"] + time_df["completion_tokens"]
            colA, colB = st.columns(2)
            with colA:
                fig = go.Figure()
                fig.add_trace(go.Scatter(x=time_df["period"], y=time_df["total_tokens"], mode="lines", name="Histórico", line=dict(color=COLOR["primary"], width=2)))
                fig.add_trace(go.Scatter(x=future_df["period"], y=future_df["tokens_pred"], mode="lines", name="Proyección", line=dict(color=COLOR["warning"], width=2, dash="dash")))
                fig.update_layout(xaxis_title=unit_label.capitalize(), yaxis_title="Tokens")
                st.plotly_chart(chart_layout(fig, 300), use_container_width=True)
            with colB:
                fig2 = go.Figure()
                fig2.add_trace(go.Scatter(x=time_df["period"], y=time_df["total_cost_usd"], mode="lines", name="Histórico", line=dict(color=COLOR["accent"], width=2)))
                fig2.add_trace(go.Scatter(x=future_df["period"], y=future_df["cost_pred"], mode="lines", name="Proyección", line=dict(color=COLOR["critical"], width=2, dash="dash")))
                fig2.update_layout(xaxis_title=unit_label.capitalize(), yaxis_title="Coste USD")
                st.plotly_chart(chart_layout(fig2, 300), use_container_width=True)

    st.divider()
    st.markdown("##### Proyección mensual por equipo")
    if not consumers_df.empty and overview.get("current_spend_usd", 0) > 0:
        days_elapsed = max(daily_df["day"].nunique() if not daily_df.empty else 1, 1)
        avg_daily = overview.get("total_cost_usd", 0) / days_elapsed
        proj_rows = []
        for _, row in consumers_df.iterrows():
            share = row["current_spend_usd"] / max(float(overview.get("current_spend_usd", 1)), 1e-10)
            proj_rows.append({
                "Equipo": row["name"],
                "Gastado actual": row["current_spend_usd"],
                "Proyección 30 días": avg_daily * 30 * share,
                "Presupuesto": row["monthly_budget_usd"],
            })
        proj_df = pd.DataFrame(proj_rows)

        fig = go.Figure()
        fig.add_trace(go.Bar(name="Gastado actual", x=proj_df["Equipo"], y=proj_df["Gastado actual"], marker_color=COLOR["accent"]))
        fig.add_trace(go.Bar(name="Proyección 30 días", x=proj_df["Equipo"], y=proj_df["Proyección 30 días"], marker_color=COLOR["warning"], opacity=0.75))
        fig.add_trace(go.Scatter(name="Límite de presupuesto", x=proj_df["Equipo"], y=proj_df["Presupuesto"],
                                  mode="markers", marker=dict(symbol="line-ew-open", size=18, color=COLOR["danger"], line_width=2)))
        fig.update_layout(barmode="group")
        st.plotly_chart(chart_layout(fig, 320), use_container_width=True)
        st.caption("Estimación de gasto a 30 días por equipo, en función de su ritmo de consumo actual.")
    else:
        st.info("Sin gasto suficiente todavía para proyectar por equipo.")


# ═══════════════ AUDITORÍA ═══════════════
with tab_audit:
    if recent_df.empty:
        st.info("Sin registros de auditoría todavía.")
    else:
        st.markdown("##### Actividad reciente")
        fig = px.scatter(
            recent_df.head(80), x="created_at", y="consumer_id",
            color="target_model", color_discrete_map=MODEL_COLORS,
            size="total_cost_usd", size_max=18,
            hover_data=["routing_method", "prompt_tokens", "completion_tokens", "total_cost_usd"],
            labels={"created_at": "Fecha", "consumer_id": "Equipo", "target_model": "Modelo"}
        )
        st.plotly_chart(chart_layout(fig, 320), use_container_width=True)
        st.caption("Cada punto es una solicitud auditada; el tamaño representa el coste generado.")

        st.markdown("##### Registro completo")
        display_cols = ["created_at", "consumer_name", "user_name", "target_model", "routing_method",
                        "prompt_tokens", "completion_tokens", "total_cost_usd", "estimated_savings_usd", "routing_reason"]
        available_cols = [c for c in display_cols if c in recent_df.columns]
        st.dataframe(
            recent_df[available_cols].sort_values("created_at", ascending=False).rename(columns={
                "created_at": "Fecha", "consumer_name": "Equipo", "user_name": "Usuario",
                "target_model": "Modelo usado", "routing_method": "Regla",
                "prompt_tokens": "Tokens entrada", "completion_tokens": "Tokens salida",
                "total_cost_usd": "Coste (USD)", "estimated_savings_usd": "Ahorro (USD)",
                "routing_reason": "Motivo"
            }),
            use_container_width=True, hide_index=True
        )


# ═══════════════ ALERTAS ═══════════════
with tab_alerts:
    st.markdown("##### Notificaciones de presupuesto")
    st.markdown(
        '<p class="section-caption">Cada vez que un equipo cruza el 80% (aviso), 90% (crítico) o 100% (bloqueo) de su '
        'presupuesto, el proxy registra la alerta aquí, la muestra como banner en el chat y, si '
        '<code>FINOPS_ALERT_WEBHOOK_URL</code> está configurado, la reenvía a un canal externo.</p>',
        unsafe_allow_html=True
    )

    if notifications_df.empty:
        st.info("Sin alertas generadas todavía.")
    else:
        level_counts = notifications_df["level"].value_counts()
        c1, c2, c3 = st.columns(3)
        c1.metric(ALERT_LABELS["warning"], int(level_counts.get("warning", 0)))
        c2.metric(ALERT_LABELS["critical"], int(level_counts.get("critical", 0)))
        c3.metric(ALERT_LABELS["blocked"], int(level_counts.get("blocked", 0)))

        chart_df = notifications_df.groupby("level").size().reset_index(name="count")
        chart_df["label"] = chart_df["level"].map(ALERT_LABELS)
        fig = px.bar(chart_df, x="label", y="count", color="level", color_discrete_map=ALERT_COLORS,
                     labels={"label": "", "count": "Nº de alertas"})
        fig.update_layout(showlegend=False)
        st.plotly_chart(chart_layout(fig, 280), use_container_width=True)

        st.markdown("##### Historial")
        st.dataframe(
            notifications_df[["created_at", "level", "consumer_name", "message", "channel"]].rename(columns={
                "created_at": "Fecha", "level": "Nivel", "consumer_name": "Equipo",
                "message": "Mensaje", "channel": "Canal"
            }),
            use_container_width=True, hide_index=True
        )

st.divider()
st.caption("AI FinOps Proxy · Mercedes-Benz Hackathon")
