// api/cleanupMemories.js
import admin from "firebase-admin";

const initFirebaseAdmin = () => {
  if (admin.apps.length) return admin;
  const saBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!saBase64) throw new Error("No FIREBASE_SERVICE_ACCOUNT_BASE64 in env");
  const sa = JSON.parse(Buffer.from(saBase64, "base64").toString("utf8"));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin;
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cleanup-secret");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Para evitar que cualquiera borre todo, requerimos un secret header
  const secret = req.headers["x-cleanup-secret"];
  if (!secret || secret !== process.env.CLEANUP_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    initFirebaseAdmin();
    const db = admin.firestore();

    // Define cuántas memorias mantener por NPC
    const KEEP = parseInt(process.env.KEEP_MEMORIES || "50", 10);

    const npcDocs = await db.collection("NPCs").get();
    for (const npcDoc of npcDocs.docs) {
      const memColl = db.collection("NPCs").doc(npcDoc.id).collection("memories');
      const snap = await memColl.orderBy("timestamp","desc").get();
      const docs = snap.docs;
      if (docs.length > KEEP) {
        const toDelete = docs.slice(KEEP);
        for (const d of toDelete) {
          await d.ref.delete();
        }
      }
    }

    return res.json({ ok: true, kept: KEEP });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error cleaning memories", details: err.message });
  }
}
