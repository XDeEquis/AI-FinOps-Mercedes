import streamlit as st
import pandas as pd
import sqlite3
import plotly.express as px
import os

st.set_page_config(page_title="AI FinOps Dashboard", page_icon="🤖", layout="wide")

st.markdown("""
<style>
    .reportview-container { background: #0b0c10; color: #c5c6c7; }
    h1, h2, h3 { color: #ffffff; font-family: 'Inter', sans-serif; }
    .stMetric { background-color: #1a1c23; padding: 15px; border-radius: 8px; border: 1px solid #333; }
</style>
""", unsafe_allow_html=True)

st.title("📊 Mercedes-Benz AI FinOps Dashboard")

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "finops.sqlite")

@st.cache_data(ttl=5)
def load_data():
    try:
        conn = sqlite3.connect(DB_PATH)
        df_consumidores = pd.read_sql_query("SELECT * FROM consumidores", conn)
        df_auditoria = pd.read_sql_query("SELECT * FROM auditoria_llamadas", conn)
        conn.close()
        return df_consumidores, df_auditoria
    except:
        return pd.DataFrame(), pd.DataFrame()

df_consumidores, df_auditoria = load_data()

if df_consumidores.empty and df_auditoria.empty:
    st.warning("No hay datos en la base de datos.")
else:
    col1, col2, col3, col4 = st.columns(4)
    gasto_total = df_consumidores['gasto_acumulado'].sum() if not df_consumidores.empty else 0
    presupuesto_total = df_consumidores['presupuesto_maximo'].sum() if not df_consumidores.empty else 0
    
    with col1: st.metric("Gasto Total (USD)", f"${gasto_total:.4f}")
    with col2: st.metric("Presupuesto Global", f"${presupuesto_total:.2f}")
    with col3: st.metric("Peticiones AI", f"{len(df_auditoria)}")
    with col4: st.metric("Modelo Top", df_auditoria['modelo_usado'].mode()[0] if not df_auditoria.empty else "N/A")

    st.markdown("---")
    col_izq, col_der = st.columns(2)
    
    with col_izq:
        st.subheader("Gasto por Departamento")
        if not df_consumidores.empty:
            fig_gasto = px.pie(df_consumidores, values='gasto_acumulado', names='id', hole=0.4)
            st.plotly_chart(fig_gasto, use_container_width=True)
            
    with col_der:
        st.subheader("Frecuencia de Modelos Usados")
        if not df_auditoria.empty:
            modelos_count = df_auditoria['modelo_usado'].value_counts().reset_index()
            modelos_count.columns = ['Modelo', 'Peticiones']
            fig_modelos = px.bar(modelos_count, x='Modelo', y='Peticiones', color='Modelo')
            st.plotly_chart(fig_modelos, use_container_width=True)
