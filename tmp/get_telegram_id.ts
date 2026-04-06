import axios from 'axios';

const token = "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18";

async function checkUpdates() {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`);
    const updates = response.data.result;
    
    if (updates.length === 0) {
      console.log("No hay actualizaciones recientes. Asegúrate de haber escrito algo en el grupo tras añadir al bot.");
      return;
    }

    console.log("--- ACTUALIZACIONES ENCONTRADAS ---");
    updates.forEach((u: any) => {
      const chat = u.message?.chat || u.my_chat_member?.chat;
      if (chat) {
        console.log(`Chat Name: ${chat.title || chat.first_name}`);
        console.log(`Chat ID: ${chat.id}`);
        console.log(`Tipo: ${chat.type}`);
        console.log("-----------------------------------");
      }
    });
  } catch (error: any) {
    console.error("Error al obtener actualizaciones:", error.message);
  }
}

checkUpdates();
