import os
from datetime import datetime

import pandas as pd
import requests
import streamlit as st


BACKEND_URL = os.getenv("FINOPS_BACKEND_URL", "http://localhost:3000")
DASHBOARD_ENDPOINT = f"{BACKEND_URL.rstrip('/')}/v1/flow-dashboard"


st.set_page_config(
    page_title="AI FinOps Flow Dashboard",
    page_icon="📊",
    layout="wide",
)


@st.cache_data(ttl=5)
def load_dashboard_data() -> dict:
    response = requests.get(DASHBOARD_ENDPOINT, timeout=10)
    response.raise_for_status()
    return response.json()


def money(value: float) -> str:
    if value is None:
        value = 0
    if value >= 0.01:
        return f"${value:,.4f}"
    return f"${value:,.8f}"


def percent(value: float) -> str:
    if value is None:
        value = 0
    return f"{value * 100:.1f}%"


def dataframe_from(data: list[dict]) -> pd.DataFrame:
    if not data:
        return pd.DataFrame()
    return pd.DataFrame(data)


st.title("AI FinOps Flow Dashboard")
st.caption(
    "Visibilidad de costes, uso de tokens, presupuestos y reglas de routing del AI FinOps Proxy."
)

with st.sidebar:
    st.header("Configuración")
    st.write("Backend API")
    st.code(BACKEND_URL)
    st.write("Endpoint dashboard")
    st.code("/v1/flow-dashboard")
    if st.button("Actualizar datos"):
        st.cache_data.clear()
        st.rerun()

try:
    data = load_dashboard_data()
except Exception as exc:
    st.error("No se pudo conectar con el backend FinOps.")
    st.info("Asegúrate de tener el backend activo con `cd backend && npm start`.")
    st.exception(exc)
    st.stop()

overview = data.get("overview", {})
generated_at = data.get("generated_at")

st.success(f"Datos cargados correctamente desde el backend. Última actualización: {generated_at}")

metric_col_1, metric_col_2, metric_col_3, metric_col_4 = st.columns(4)
metric_col_1.metric("Requests auditadas", int(overview.get("total_requests", 0)))
metric_col_2.metric("Coste acumulado", money(float(overview.get("current_spend_usd", 0))))
metric_col_3.metric(
    "Presupuesto usado",
    percent(float(overview.get("budget_usage_ratio", 0))),
    help="Gasto acumulado total dividido entre presupuesto mensual total."
)
metric_col_4.metric(
    "Proyección mensual",
    money(float(overview.get("projected_monthly_spend_usd", 0))),
    help="Estimación simple: coste medio diario observado x 30 días."
)

token_col_1, token_col_2, token_col_3, token_col_4 = st.columns(4)
token_col_1.metric("Tokens input", int(overview.get("total_prompt_tokens", 0)))
token_col_2.metric("Tokens output", int(overview.get("total_completion_tokens", 0)))
token_col_3.metric("Coste medio/request", money(float(overview.get("avg_cost_per_request", 0))))
token_col_4.metric(
    "Coste evitable estimado",
    money(float(overview.get("estimated_avoidable_cost_usd", 0))),
    help="Diferencia estimada si el uso de Mistral se hubiera resuelto con llama3.2:3b. Úsalo como señal, no como verdad absoluta."
)

st.divider()

consumers_df = dataframe_from(data.get("consumers", []))
models_df = dataframe_from(data.get("model_usage", []))
routing_df = dataframe_from(data.get("routing_usage", []))
daily_df = dataframe_from(data.get("daily_spend", []))
recent_df = dataframe_from(data.get("recent_requests", []))

tab_consumers, tab_models, tab_routing, tab_timeline, tab_audit = st.tabs(
    ["Equipos", "Modelos", "Routing", "Tendencia", "Auditoría"]
)

with tab_consumers:
    st.subheader("Gasto por consumidor")
    if consumers_df.empty:
        st.info("Todavía no hay consumidores o llamadas registradas.")
    else:
        chart_df = consumers_df.set_index("name")[["current_spend_usd", "monthly_budget_usd"]]
        st.bar_chart(chart_df)

        alert_df = consumers_df.copy()
        alert_df["budget_usage_percent"] = alert_df["budget_usage_ratio"] * 100
        risky = alert_df[alert_df["budget_usage_ratio"] >= 0.8]
        if not risky.empty:
            st.warning("Equipos con gasto superior al 80% del presupuesto.")
            st.dataframe(
                risky[["id", "name", "department", "current_spend_usd", "monthly_budget_usd", "budget_usage_percent"]],
                use_container_width=True,
                hide_index=True,
            )

        st.dataframe(
            alert_df[
                [
                    "id",
                    "name",
                    "department",
                    "requests_count",
                    "prompt_tokens",
                    "completion_tokens",
                    "tracked_cost_usd",
                    "current_spend_usd",
                    "remaining_budget_usd",
                    "budget_usage_percent",
                ]
            ],
            use_container_width=True,
            hide_index=True,
        )

with tab_models:
    st.subheader("Uso y coste por modelo")
    if models_df.empty:
        st.info("Todavía no hay uso por modelo.")
    else:
        st.bar_chart(models_df.set_index("model_id")[["requests_count", "total_cost_usd"]])
        st.dataframe(models_df, use_container_width=True, hide_index=True)

with tab_routing:
    st.subheader("Impacto de las reglas de routing")
    st.write(
        "Esta vista demuestra los criterios explícitos de ahorro/calidad: "
        "`default_low_cost`, `quality_reasoning_keywords`, `cost_guardrail_long_prompt`, "
        "`budget_guardrail_critical`, etc."
    )
    if routing_df.empty:
        st.info("Todavía no hay decisiones de routing registradas.")
    else:
        st.bar_chart(routing_df.set_index("routing_method")[["requests_count", "total_cost_usd"]])
        st.dataframe(routing_df, use_container_width=True, hide_index=True)

with tab_timeline:
    st.subheader("Evolución diaria de coste y tokens")
    if daily_df.empty:
        st.info("Todavía no hay histórico diario.")
    else:
        daily_df["day"] = pd.to_datetime(daily_df["day"])
        timeline = daily_df.set_index("day")
        st.line_chart(timeline[["total_cost_usd"]])
        st.area_chart(timeline[["prompt_tokens", "completion_tokens"]])
        st.dataframe(daily_df, use_container_width=True, hide_index=True)

with tab_audit:
    st.subheader("Últimas llamadas auditadas")
    if recent_df.empty:
        st.info("Todavía no hay registros en audit_logs.")
    else:
        recent_df["created_at"] = pd.to_datetime(recent_df["created_at"])
        st.dataframe(
            recent_df[
                [
                    "created_at",
                    "consumer_id",
                    "consumer_name",
                    "department",
                    "target_model",
                    "routing_method",
                    "prompt_tokens",
                    "completion_tokens",
                    "total_cost_usd",
                    "routing_reason",
                ]
            ],
            use_container_width=True,
            hide_index=True,
        )

st.divider()
st.caption(
    "Demo FinOps: este dashboard consume `/v1/flow-dashboard`, que agrega `consumers`, "
    "`models` y `audit_logs` desde SQLite."
)
