import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from 'fs';
import * as path from 'path';

const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const adminApp = initializeApp({
  projectId: firebaseConfig.projectId
});
const db = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId || "(default)");

async function setup() {
  try {
    console.log("Setting up project 'Monitoreo JMAI'...");
    const projectRef = db.collection("projects").doc("monitoreo-jmai");
    await projectRef.set({
      name: "Monitoreo JMAI",
      description: "Proyecto principal de monitoreo inteligente",
      telegramBotToken: "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18",
      telegramChatId: "", // User needs to provide this
      ownerId: "default_user",
      createdAt: new Date().toISOString()
    });
    console.log("Project created successfully!");

    // Add a sample task
    const taskRef = db.collection("projects/monitoreo-jmai/tasks").doc("sample-task");
    await taskRef.set({
      title: "Verificar Integración Telegram",
      description: "Realizar una prueba de conexión desde la pestaña de Ajustes.",
      responsible: "Usuario",
      status: "pendiente",
      priority: "media",
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      projectId: "monitoreo-jmai",
      createdAt: new Date().toISOString()
    });
    console.log("Sample task created!");
    process.exit(0);
  } catch (error) {
    console.error("Error setting up project:", error);
    process.exit(1);
  }
}

setup();
