import express from "express";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import path from "path";
import * as fs from "fs";
import cron from "node-cron";
import axios from "axios";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

dotenv.config({ path: ".env.local" });

// Initialize Firebase Admin with Service Account
const serviceAccountPath = path.join(process.cwd(), "service-account.json");

const adminApp = initializeApp({
  credential: cert(serviceAccountPath),
  projectId: firebaseConfig.projectId
});
const adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId || "(default)");

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pendiente' | 'en-proceso' | 'completado' | 'urgente' | 'descartado';
  priority: 'baja' | 'media' | 'alta' | 'muy-alto';
  responsible: string;
  telegramUsername?: string;
  startDate?: string;
  endDate: string;
  projectId: string;
}

const app = express();
const PORT = 3000;

async function sendTelegramMessage(token: string, chatId: string, message: string) {
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
}

// Cron job to run every day at 8:00 AM (UTC)
// Note: You might want to adjust the cron schedule to match your local time zone.
cron.schedule("0 13 * * *", async () => { // 13:00 UTC is 08:00 AM Peru (UTC-5)
  console.log("Running daily smart monitoring cron (08:00 AM Peru)...");
  await runSmartMonitoring();
});

const BOT_TOKEN = "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18";
const CHAT_ID = "-5142891023";

async function runSmartMonitoring(targetProjectId?: string) {
  try {
    const projectsSnapshot = targetProjectId 
      ? [await adminDb.collection('projects').doc(targetProjectId).get()]
      : (await adminDb.collection('projects').get()).docs;
    
    for (const projectDoc of projectsSnapshot) {
      if (!projectDoc.exists) continue;
      const project = projectDoc.data();
      if (!project) continue;
      
      const telegramBotToken = project.telegramBotToken || BOT_TOKEN;
      const telegramChatId = project.telegramChatId || CHAT_ID;
      const name = project.name || "Proyecto JMAI";

      const tasksSnapshot = await adminDb.collection(`projects/${projectDoc.id}/tasks`)
        .where('status', 'in', ['pendiente', 'en-proceso', 'urgente'])
        .get();

      const tasks = tasksSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task));
      if (tasks.length === 0) {
        if (targetProjectId) await sendTelegramMessage(telegramBotToken, telegramChatId, `✅ *${name}*: No hay tareas pendientes por monitorear hoy.`);
        continue;
      }

      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const next3Days = new Date();
      next3Days.setDate(today.getDate() + 3);
      const next3DaysStr = next3Days.toISOString().split('T')[0];

      const overdue = tasks.filter(t => t.endDate < todayStr || t.priority === 'muy-alto');
      const dueToday = tasks.filter(t => t.endDate === todayStr);
      const startingToday = tasks.filter(t => t.startDate === todayStr);
      const upcoming = tasks.filter(t => t.endDate > todayStr && t.endDate <= next3DaysStr && t.priority !== 'muy-alto');

      if (overdue.length === 0 && dueToday.length === 0 && startingToday.length === 0 && upcoming.length === 0) {
        if (targetProjectId) await sendTelegramMessage(telegramBotToken, telegramChatId, `✅ *${name}*: Todo está bajo control. No hay vencimientos próximos.`);
        continue;
      }

      let message = `🧠 *Monitoreo Inteligente - ${name}*\n`;
      message += `📅 _${format(today, 'PPPP', { locale: es })}_\n\n`;

      if (overdue.length > 0) {
        message += `🚨 *URGENTES / RETRASADAS*\n`;
        overdue.forEach(t => {
          const resp = t.telegramUsername ? `@${t.telegramUsername}` : t.responsible;
          message += `• *${t.title}* (${resp})\n`;
          message += `  _Venció: ${t.endDate}_ | Prioridad: ${t.priority.toUpperCase()}\n`;
        });
        message += `\n`;
      }
 
      if (dueToday.length > 0) {
        message += `⏳ *VENCEN HOY*\n`;
        dueToday.forEach(t => {
          const resp = t.telegramUsername ? `@${t.telegramUsername}` : t.responsible;
          message += `• *${t.title}* (${resp})\n`;
        });
        message += `\n`;
      }
 
      if (startingToday.length > 0) {
        message += `🚀 *INICIAN HOY*\n`;
        startingToday.forEach(t => {
          const resp = t.telegramUsername ? `@${t.telegramUsername}` : t.responsible;
          message += `• *${t.title}* (${resp})\n`;
        });
        message += `\n`;
      }
 
      if (upcoming.length > 0) {
        message += `📅 *PRÓXIMOS 3 DÍAS*\n`;
        upcoming.forEach(t => {
          const resp = t.telegramUsername ? `@${t.telegramUsername}` : t.responsible;
          message += `• *${t.title}* (${t.endDate}) - ${resp}\n`;
        });
        message += `\n`;
      }

      message += `🔗 [Ver Tablero](${process.env.APP_URL || 'https://ais-dev-6wfh7nmwzjvyybkjlkbmdl-288988329128.us-west2.run.app'})`;
      
      await sendTelegramMessage(telegramBotToken, telegramChatId, message);
    }
  } catch (error) {
    console.error("Error in monitoring logic:", error);
    throw error;
  }
}

async function startServer() {
  app.use(express.json());

  app.post("/api/run-monitoring", async (req, res) => {
    const { projectId } = req.body;
    if (!projectId) return res.status(400).send("No project ID");
    
    try {
      await runSmartMonitoring(projectId);
      res.send({ status: "ok" });
    } catch (error: any) {
      console.error(error);
      res.status(500).send(error.message || error);
    }
  });

  app.post("/api/test-telegram", async (req, res) => {
    const { botToken, chatId: bodyChatId } = req.body;
    
    // Fallback absoluto si todo lo demas falla
    const DEFAULT_TOKEN = "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18";
    const DEFAULT_CHAT = "-5142891023";

    const token = botToken || process.env.VITE_TELEGRAM_BOT_TOKEN || DEFAULT_TOKEN;
    const chatId = bodyChatId || process.env.VITE_TELEGRAM_CHAT_ID || DEFAULT_CHAT;
    
    console.log(`[Test-Telegram] Usando Token: ${token.substring(0,15)}... Chat: ${chatId}`);

    if (!token || token.length < 10 || !chatId) {
      return res.status(400).send("Faltan credenciales de Telegram o son inválidas");
    }

    try {
      const message = "✅ *Conexión Exitosa*\nEl bot de Gestor JMAI está configurado correctamente para este proyecto. 🚀";
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      });
      res.send({ status: "ok" });
    } catch (error: any) {
      console.error(error);
      res.status(500).send(error.message || "Error al enviar mensaje de prueba");
    }
  });

  app.post("/api/setup-default-project", async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      const projectId = "monitoreo-jmai";
      const projectRef = adminDb.collection("projects").doc(projectId);
      
      await projectRef.set({
        name: "Monitoreo JMAI",
        description: "Proyecto principal gestionado por JMAI",
        telegramBotToken: botToken || process.env.VITE_TELEGRAM_BOT_TOKEN || "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18",
        telegramChatId: chatId || "",
        ownerId: "default_user",
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.status(200).send({ status: "ok", projectId });
    } catch (error: any) {
      console.error(error);
      res.status(500).send(error.message);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
