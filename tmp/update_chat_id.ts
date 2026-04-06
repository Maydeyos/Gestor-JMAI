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

async function updateProject() {
  try {
    const projectId = "monitoreo-jmai";
    console.log(`Updating project '${projectId}' with Chat ID -5142891023...`);
    
    await db.collection("projects").doc(projectId).set({
      telegramChatId: "-5142891023",
      telegramBotToken: "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18",
      updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log("Project updated successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error updated project:", error);
    process.exit(1);
  }
}

updateProject();
