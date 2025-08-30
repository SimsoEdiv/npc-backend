// /api/interaccionNPC.js
import admin from "firebase-admin";
import OpenAI from "openai";

// 🔹 Inicializar Firebase solo si no está inicializado
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_PRIVATE_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ Firebase inicializado correctamente");
  } catch (e) {
    console.error("❌ Error inicializando Firebase:", e);
  }
}

const db = admin.firestore();

// 🔹 Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // 🔹 CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // 🔹 Parse body
  let body = {};
  if (req.method === "POST") {
    try {
      body = req.body || JSON.parse(await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => data += chunk);
        req.on("end", () => resolve(data));
        req.on("error", err => reject(err));
      }));
      console.log("📩 BODY PARSEADO:", body);
    } catch (e) {
      console.error("❌ Error parseando body:", e);
      return res.status(400).json({ error: "JSON inválido" });
    }
  }

  // 🔹 GET: devolver últimas interacciones
  if (req.method === "GET") {
    try {
      const snapshot = await db.collection("NPCs").orderBy("timestamp", "desc").limit(20).get();
      const interacciones = snapshot.docs.map(doc => doc.data());
      console.log("📄 GET - Interacciones devueltas:", interacciones.length);
      return res.status(200).json({ interacciones });
    } catch (e) {
      console.error("❌ Error GET:", e);
      return res.status(500).json({ error: "Error al obtener interacciones" });
    }
  }

  // 🔹 POST: recibir mensaje, llamar a OpenAI y guardar en Firebase
  if (req.method === "POST") {
    const { jugador, mensaje } = body;
    console.log("📩 POST recibido:", jugador, mensaje);

    if (!mensaje) return res.status(400).json({ error: "Mensaje vacío" });

    try {
      // 🔹 Llamada a OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Eres un NPC del juego, responde breve y en tono divertido." },
          { role: "user", content: mensaje }
        ],
      });

      const respuesta = completion.choices[0].message.content;
      console.log("🤖 Respuesta IA:", respuesta);

      // 🔹 Guardar interacción en Firebase
      const docRef = await db.collection("NPCs").add({
        jugador,
        mensaje,
        respuesta,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log("💾 Interacción guardada en Firebase");

      // 🔹 Opción 1: devolver la interacción como array
      return res.status(200).json({ 
        interacciones: [{ id: docRef.id, jugador, mensaje, respuesta }] 
      });

    } catch (e) {
      console.error("❌ Error POST:", e);
      return res.status(500).json({ error: "Error al procesar la interacción" });
    }
  }

  return res.status(405).json({ error: "Método no permitido" });
}
