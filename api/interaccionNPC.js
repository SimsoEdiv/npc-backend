// api/interaccionNPC.js
import admin from "firebase-admin";

const initFirebaseAdmin = () => {
  if (admin.apps.length) return admin;
  // Espera encontrar FIREBASE_SERVICE_ACCOUNT_BASE64 en env (base64 del JSON de service account)
  const saBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!saBase64) throw new Error("No FIREBASE_SERVICE_ACCOUNT_BASE64 in env");
  const sa = JSON.parse(Buffer.from(saBase64, "base64").toString("utf8"));

  admin.initializeApp({
    credential: admin.credential.cert(sa)
  });
  return admin;
};

// Handler para Vercel serverless (export default)
export default async function handler(req, res) {
  // Habilitar CORS simple
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cleanup-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    initFirebaseAdmin();
    const db = admin.firestore();

    const { idNPC, mensajeJugador, jugadorId } = req.body || {};
    if (!idNPC || !mensajeJugador) {
      return res.status(400).json({ error: "Falta idNPC o mensajeJugador" });
    }

    // 1) Leer datos del NPC
    const npcDoc = await db.collection("NPCs").doc(idNPC).get();
    const npc = npcDoc.exists ? npcDoc.data() : {
      nombre: idNPC,
      personalidad: "NPC neutral y breve"
    };

    // 2) Recuperar últimas memorias (limitadas)
    const memSnap = await db.collection("NPCs").doc(idNPC)
      .collection("memories")
      .orderBy("timestamp", "desc")
      .limit(10)
      .get();

    const memories = memSnap.docs.map(d => {
      const data = d.data();
      return {
        timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null,
        content: data.content,
        type: data.type || "chat",
        fromPlayer: data.fromPlayer || null
      };
    }).reverse(); // de más antiguo a nuevo

    // 3) Construir prompt / messages para OpenAI
    // ************* Reemplazá model si querés *************
    const systemMsg = `Eres ${npc.nombre}. Personalidad: ${npc.personalidad || ""}. Responde brevemente (1-3 frases) y de forma coherente con tu memoria.`;
    const memoryText = memories.length ? "Memoria reciente:\n" + memories.map(m => `- ${m.timestamp || ""}: ${m.content}`).join("\n") : "No tienes memoria reciente.";
    const userMsg = `Memoria:\n${memoryText}\n\nJugador dice: "${mensajeJugador}"\nResponde como ${npc.nombre}.`;

    // 4) Llamada a OpenAI
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return res.status(500).json({ error: "No OPENAI_API_KEY en env" });

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // o "gpt-4o" / "gpt-4o-mini" según disponibilidad / costos
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg }
        ],
        max_tokens: 200,
        temperature: 0.8
      })
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      console.error("OpenAI error:", errText);
      return res.status(502).json({ error: "Error de OpenAI", details: errText });
    }

    const openaiJson = await openaiResp.json();
    const respuesta = openaiJson.choices?.[0]?.message?.content?.trim() || "…";

    // 5) Guardar la respuesta como memoria (opcional: markar importancia)
    await db.collection("NPCs").doc(idNPC).collection("memories").add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      content: `NPC respondió: ${respuesta}`,
      type: "npc_response",
      fromPlayer: jugadorId || null
    });

    // 6) Devolver la respuesta
    return res.json({ respuesta });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno", details: err.message || err.toString() });
  }
}
