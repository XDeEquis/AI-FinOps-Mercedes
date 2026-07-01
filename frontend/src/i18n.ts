export type Language = 'es' | 'en' | 'de' | 'fr' | 'it' | 'ja' | 'ko';

export const translations = {
  en: {
    team: "Team:",
    budgetUsage: "Budget Usage",
    activeModels: "Active Models",
    cost: "Cost:",
    welcomeMessage: "Hello! I am the AI FinOps Proxy. Send a message to see how I route requests to different models to optimize costs.",
    mockResponse: "*(Mock Response)* I processed your request using **{model}** because it's the most efficient option for this type of task based on our FinOps rules.",
    routing: "Routing:",
    costLabel: "Cost:",
    inputPlaceholder: "Send a message to the proxy..."
  },
  es: {
    team: "Equipo:",
    budgetUsage: "Uso de Presupuesto",
    activeModels: "Modelos Activos",
    cost: "Coste:",
    welcomeMessage: "¡Hola! Soy el Proxy AI FinOps. Envía un mensaje para ver cómo enruto las peticiones a diferentes modelos para optimizar costes.",
    mockResponse: "*(Respuesta simulada)* He procesado tu petición usando **{model}** porque es la opción más eficiente para este tipo de tarea según nuestras reglas de FinOps.",
    routing: "Enrutamiento:",
    costLabel: "Coste:",
    inputPlaceholder: "Envía un mensaje al proxy..."
  },
  de: {
    team: "Team:",
    budgetUsage: "Budgetnutzung",
    activeModels: "Aktive Modelle",
    cost: "Kosten:",
    welcomeMessage: "Hallo! Ich bin der AI FinOps Proxy. Senden Sie eine Nachricht, um zu sehen, wie ich Anfragen an verschiedene Modelle weiterleite, um Kosten zu optimieren.",
    mockResponse: "*(Simulierte Antwort)* Ich habe Ihre Anfrage mit **{model}** verarbeitet, da dies basierend auf unseren FinOps-Regeln die effizienteste Option für diese Art von Aufgabe ist.",
    routing: "Routing:",
    costLabel: "Kosten:",
    inputPlaceholder: "Senden Sie eine Nachricht an den Proxy..."
  },
  fr: {
    team: "Équipe:",
    budgetUsage: "Utilisation du budget",
    activeModels: "Modèles Actifs",
    cost: "Coût:",
    welcomeMessage: "Bonjour! Je suis le Proxy AI FinOps. Envoyez un message pour voir comment j'achemine les demandes vers différents modèles pour optimiser les coûts.",
    mockResponse: "*(Réponse simulée)* J'ai traité votre demande en utilisant **{model}** car c'est l'option la plus efficace pour ce type de tâche selon nos règles FinOps.",
    routing: "Routage:",
    costLabel: "Coût:",
    inputPlaceholder: "Envoyez un message au proxy..."
  },
  it: {
    team: "Squadra:",
    budgetUsage: "Utilizzo del Budget",
    activeModels: "Modelli Attivi",
    cost: "Costo:",
    welcomeMessage: "Ciao! Sono il Proxy AI FinOps. Invia un messaggio per vedere come indirizzo le richieste a modelli diversi per ottimizzare i costi.",
    mockResponse: "*(Risposta simulata)* Ho elaborato la tua richiesta utilizzando **{model}** perché è l'opzione più efficiente per questo tipo di attività in base alle nostre regole FinOps.",
    routing: "Routing:",
    costLabel: "Costo:",
    inputPlaceholder: "Invia un messaggio al proxy..."
  },
  ja: {
    team: "チーム:",
    budgetUsage: "予算の使用状況",
    activeModels: "アクティブなモデル",
    cost: "コスト:",
    welcomeMessage: "こんにちは！私は AI FinOps プロキシです。コストを最適化するために、さまざまなモデルにリクエストをルーティングする方法を確認するには、メッセージを送信してください。",
    mockResponse: "*(シミュレートされた応答)* FinOps のルールに基づき、この種のタスクに最も効率的なオプションであるため、**{model}** を使用してリクエストを処理しました。",
    routing: "ルーティング:",
    costLabel: "コスト:",
    inputPlaceholder: "プロキシにメッセージを送信..."
  },
  ko: {
    team: "팀:",
    budgetUsage: "예산 사용량",
    activeModels: "활성 모델",
    cost: "비용:",
    welcomeMessage: "안녕하세요! 저는 AI FinOps 프록시입니다. 비용 최적화를 위해 다른 모델로 요청을 라우팅하는 방법을 보려면 메시지를 보내주세요.",
    mockResponse: "*(시뮬레이션된 응답)* FinOps 규칙에 따라 이 유형의 작업에 가장 효율적인 옵션이기 때문에 **{model}**을(를) 사용하여 요청을 처리했습니다.",
    routing: "라우팅:",
    costLabel: "비용:",
    inputPlaceholder: "프록시에 메시지 보내기..."
  }
};
