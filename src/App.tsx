/**
 * Gestor JMAI - Versión 1.0.1 (Data Recovery & UI Repair)
 * Fecha: 2026-04-06
 */
import React, { useState, useEffect, useMemo } from "react";
import { 
  Plus, 
  LayoutDashboard, 
  Trello, 
  BarChart3, 
  Settings, 
  Send, 
  Search, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  MoreVertical,
  Calendar,
  User,
  MessageSquare,
  Paperclip,
  Upload,
  Trash2,
  Edit2,
  Check
} from "lucide-react";
import * as Papa from "papaparse";
import * as XLSX from "xlsx";
import { motion, AnimatePresence } from "motion/react";
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  Timestamp,
  orderBy
} from "firebase/firestore";
import { db } from "./firebase";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import axios from "axios";

// Configuracion Telegram Global
const BOT_TOKEN = "8665878985:AAGSg_0VasVwQdvTod_0eqMMUJSVlTa--18";
const CHAT_ID = "-5142891023";

// Interfaces
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
  createdAt: any;
  subtasks?: { id: string; text: string; completed: boolean; }[];
  estimatedDays?: number;
}

interface Project {
  id: string;
  name: string;
  description: string;
  telegramChatId: string;
  telegramBotToken: string;
  ownerId: string;
}

// Main App Component
export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'metrics' | 'settings'>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterResponsible, setFilterResponsible] = useState<string>("Todos");
  const [filterPriority, setFilterPriority] = useState<string>("Todas");
  const [filterStatus, setFilterStatus] = useState<string>("Todos");
  const [sortByDate, setSortByDate] = useState<'asc' | 'desc' | null>(null);

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [toasts, setToasts] = useState<{id: string, message: string, type: 'success' | 'error'}[]>([]);

  const addToast = (message: any, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    const safeMessage = typeof message === 'string' ? message : JSON.stringify(message);
    setToasts(prev => [...prev, { id, message: safeMessage, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  // Form States
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    responsible: "",
    telegramUsername: "",
    priority: "media" as Task['priority'],
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    subtasks: [] as { id: string; text: string; completed: boolean; }[],
    estimatedDays: 1
  });

  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    telegramBotToken: BOT_TOKEN,
    telegramChatId: CHAT_ID
  });

  // Fetch Projects
  useEffect(() => {
    const q = query(collection(db, "projects"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let projs = snapshot.docs.map(d => {
        const data = d.data();
        let token = data.telegramBotToken || "";
        if (token.startsWith("8665878985") && token.length < 40) {
          token = BOT_TOKEN;
        }
        return { id: d.id, ...data, telegramBotToken: token } as Project;
      });
      
      // CARGAR PROYECTOS LOCALES: Fusionar con los de la nube
      const storedLocalProjs = localStorage.getItem("local-projects");
      if (storedLocalProjs) {
        const localProjs = JSON.parse(storedLocalProjs);
        const cloudIds = projs.map(p => p.id);
        const filteredLocals = localProjs.filter((lp: Project) => !cloudIds.includes(lp.id));
        projs = [...projs, ...filteredLocals];
      }
      
      // ASEGURAR VISIBILIDAD DE PROYECTO LOCAL: Si hay tareas recuperadas, mostrarlo siempre
      const recoveredTasks = localStorage.getItem("local-tasks-local-proj");
      const hasRecoveredTasks = recoveredTasks && JSON.parse(recoveredTasks).length > 0;
      
      if (hasRecoveredTasks && !projs.find(p => p.id === "local-proj")) {
        projs.push({ 
          id: "local-proj", 
          name: "Proyecto JMAI (Local)", 
          description: "Tareas recuperadas localmente",
          telegramBotToken: BOT_TOKEN,
          telegramChatId: CHAT_ID,
          ownerId: "default_user"
        });
      }

      // Si sigue sin haber nada de nada, añadir el por defecto
      if (projs.length === 0) {
        projs = [{ 
          id: "local-proj", 
          name: "Proyecto JMAI (Local)", 
          description: "Usando almacenamiento local por problemas de conexión",
          telegramBotToken: BOT_TOKEN,
          telegramChatId: CHAT_ID,
          ownerId: "default_user"
        }];
      }

      setProjects(projs);
      
      // AUTO-SELECCIÓN INTELIGENTE:
      // 1. Si no hay nada seleccionado, buscar el proyecto de la nube.
      // 2. Si lo que está seleccionado es el "Proyecto Local" pero ha aparecido uno de la nube, cambiar a la nube.
      const cloudProj = projs.find(p => p.id !== "local-proj");
      
      if (cloudProj && (!selectedProject || selectedProject.id === "local-proj")) {
        console.log("Forzando selección de proyecto en la nube para sincronización compartida:", cloudProj.name);
        setSelectedProject(cloudProj);
      } else if (!selectedProject && projs.length > 0) {
        setSelectedProject(projs[0]);
      }
      
      setLoading(false);
    }, (error) => {
      console.error("Error al cargar proyectos de Firestore:", error);
      // DETECCION DE PERMISOS: Si falla por permisos, forzar modo local de inmediato
      if (error.code === 'permission-denied') {
        console.warn("Acceso denegado a Firestore. Activando Modo Rescate Local.");
      }
      
      const storedLocalProjs = localStorage.getItem("local-projects");
      if (storedLocalProjs) {
        const localProjs = JSON.parse(storedLocalProjs);
        setProjects(localProjs);
        if (localProjs.length > 0) setSelectedProject(localProjs[0]);
      } else {
        const fallbackProject: Project = { 
          id: "local-proj", 
          name: "Proyecto JMAI (Local)", 
          description: "Usando almacenamiento local por problemas de conexión",
          telegramBotToken: BOT_TOKEN,
          telegramChatId: CHAT_ID,
          ownerId: "default_user"
        };
        setProjects([fallbackProject]);
        setSelectedProject(fallbackProject);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // AUTO-REPARACION VISUAL: Si el proyecto seleccionado tiene el token truncado, lo corregimos en el estado local
  useEffect(() => {
    if (selectedProject && selectedProject.telegramBotToken && selectedProject.telegramBotToken.length < 40 && selectedProject.telegramBotToken.startsWith("8665878985")) {
      console.log("Reparando token truncado visualmente...");
      setSelectedProject({
        ...selectedProject,
        telegramBotToken: BOT_TOKEN,
        telegramChatId: selectedProject.telegramChatId || CHAT_ID
      });
    }
  }, [selectedProject]);

  // Fetch Tasks for Selected Project
  useEffect(() => {
    if (!selectedProject) return;
    
    if (selectedProject.id === "local-proj") {
      const stored = localStorage.getItem(`local-tasks-${selectedProject.id}`);
      if (stored) setTasks(JSON.parse(stored));
      return;
    }

    const q = query(
      collection(db, `projects/${selectedProject.id}/tasks`),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
    }, (err) => {
      console.error("Error cargando tareas:", err);
      // Si falla por permisos, intentamos cargar de localstorage como fallback
      const stored = localStorage.getItem(`local-tasks-${selectedProject.id}`);
      if (stored) {
        setTasks(JSON.parse(stored));
      } else if (err.code === 'permission-denied') {
        // Si no hay nada en esa clave, intentamos la clave genérica de rescate
        const legacyStored = localStorage.getItem("local-tasks");
        if (legacyStored) {
          addToast("Se detectaron tareas antiguas. Pulsa 'Reparar' en Ajustes para recuperarlas.", "error");
        }
      }
    });
    return () => unsubscribe();
  }, [selectedProject]);

  // Lógica de Filtrado y Ordenación Centralizada
  const filteredTasks = useMemo(() => {
    let result = [...tasks];
    
    // Filtro por Texto (Título/Descripción)
    if (searchQuery) {
      result = result.filter(t => 
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Filtro por Responsable
    if (filterResponsible !== 'Todos') {
      result = result.filter(t => t.responsible === filterResponsible);
    }
    
    // Filtro por Prioridad
    if (filterPriority !== 'Todas') {
      result = result.filter(t => t.priority === filterPriority);
    }
    
    // Filtro por Estado (solo si no estamos en Kanban que ya separa por estado)
    if (activeTab === 'dashboard' && filterStatus !== 'Todos') {
      result = result.filter(t => t.status === filterStatus);
    }
    
    // Ordenar por Fecha de Fin
    if (sortByDate) {
      result.sort((a, b) => {
        const dateA = new Date(a.endDate).getTime();
        const dateB = new Date(b.endDate).getTime();
        return sortByDate === 'asc' ? dateA - dateB : dateB - dateA;
      });
    } else {
      // Por defecto poner urgenes arriba
      result.sort((a,b) => (a.priority === 'muy-alto' ? -1 : 1));
    }
    
    return result;
  }, [tasks, searchQuery, filterResponsible, filterPriority, filterStatus, sortByDate, activeTab]);

  // IA Heurística de Sugerencias (Expandida)
  const getAISuggestions = (title: string) => {
    const t = title.toLowerCase();
    
    // Diccionario de sugerencias por categorías
    const categories = [
      {
        keywords: ["crm", "hubspot", "zoho", "automatizacion", "crm", "soporte"],
        subtasks: ["Mapeo de procesos", "Configuración de campos", "Importación de datos", "Pruebas de flujos de correo", "Validación final de SLA"],
        days: 5
      },
      {
        keywords: ["landing", "web", "html", "pagina", "post", "url"],
        subtasks: ["Estructura HTML/CSS", "Diseño UI/UX", "Optimización móvil", "Configuración de Formulario", "Revisión de enlaces y FB Pixel"],
        days: 4
      },
      {
        keywords: ["email", "secuencia", "envio", "copy", "plantilla"],
        subtasks: ["Redacción de Copys (Asunto/Cuerpo)", "Diseño de plantillas en HTML", "Programación de automatización", "Pruebas de entregabilidad (Inbox)"],
        days: 3
      },
      {
        keywords: ["sunat", "impuesto", "renta", "contabilidad", "declarar"],
        subtasks: ["Recopilación de facturas", "Cálculo de impuestos", "Carga de datos en portal SUNAT", "Validación de constancia de recepción"],
        days: 2
      },
      {
        keywords: ["whatsapp", "business", "sla", "guion", "chatbot"],
        subtasks: ["Configuración de Business Profile", "Redacción de guiones de respuesta", "Definición de protocolos de atención", "Pruebas con usuarios reales"],
        days: 2
      },
      {
        keywords: ["certificados", "qr", "pdf", "emision"],
        subtasks: ["Diseño de plantilla de certificado", "Generación de código QR dinámico", "Script de automatización de envío", "Prueba de escaneo y descarga"],
        days: 3
      },
      {
        keywords: ["curso", "intensivo", "clase", "reunio", "planificacio"],
        subtasks: ["Definición de temario", "Creación de materiales/presentaciones", "Configuración de plataforma (Zoom/Meet)", "Envío de recordatorios a alumnos"],
        days: 4
      },
      {
        keywords: ["diseño", "imagen", "logo", "branding", "ilustracio"],
        subtasks: ["Concepto y Sketch", "Selección de paleta de colores", "Diseño de artes finales", "Exportación para Redes Sociales"],
        days: 2
      }
    ];

    // Intentar encontrar una categoría que coincida
    for (const cat of categories) {
      if (cat.keywords.some(k => t.includes(k))) {
        return { subtasks: cat.subtasks, days: cat.days };
      }
    }

    // Fallback genérico mejorado
    return {
      subtasks: ["Análisis de requerimientos", "Ejecución de la actividad", "Revisión y ajustes", "Cierre y documentación"],
      days: 3
    };
  };

  const handleRunMonitoring = async () => {
    if (!selectedProject) return;
    addToast("Iniciando monitoreo inteligente... 🧠");
    try {
      // Intentar primero por el servidor
      await axios.post("/api/run-monitoring", { projectId: selectedProject.id });
      addToast("Monitoreo enviado exitosamente! 🚀", "success");
    } catch (error: any) {
      console.warn("Servidor falló, intentando monitoreo directo desde el cliente...", error.message);
      
      // FALLBACK: Monitoreo Directo desde el Cliente
      try {
        const botToken = (selectedProject.telegramBotToken && selectedProject.telegramBotToken.length > 40) 
          ? selectedProject.telegramBotToken 
          : BOT_TOKEN;
        const chatId = selectedProject.telegramChatId || CHAT_ID;

        // Metricas de Salud del Proyecto
        const total = tasks.length;
        const completadas = tasks.filter(t => t.status === 'completado').length;
        const porc = total > 0 ? Math.round((completadas / total) * 100) : 0;
        const progressEmoji = "▓".repeat(Math.floor(porc/10)) + "░".repeat(10 - Math.floor(porc/10));

        // Filtrar tareas críticas/retrasadas
        const todayStr = new Date().toISOString().split('T')[0];
        const todayDate = new Date();
        const overdue = tasks.filter(t => (t.endDate < todayStr || t.priority === 'muy-alto') && t.status !== 'completado' && t.status !== 'descartado');
        
        let message = `🤵 *SCRUMBOT - Tu Project Manager*\n`;
        message += `📈 *Estado del Sprint: ${selectedProject.name}*\n`;
        message += `\`[${progressEmoji}] ${porc}%\` (${completadas}/${total} tareas)\n\n`;
        
        if (overdue.length > 0) {
          message += `⚠️ *ANÁLISIS DE RIESGO POR PERSONA:*\n`;
          
          const responsibles = Array.from(new Set(overdue.map(t => t.responsible)));
          
          responsibles.forEach(resp => {
            const personTasks = overdue.filter(t => t.responsible === resp);
            const firstTaskWithUsername = personTasks.find(t => t.telegramUsername && t.telegramUsername.startsWith('@'));
            const mention = firstTaskWithUsername ? firstTaskWithUsername.telegramUsername : `*${resp}*`;
            
            message += `👤 ${mention}, atención aquí:\n`;
            personTasks.forEach(t => {
              const subtasksTotal = t.subtasks?.length || 0;
              const subtasksDone = t.subtasks?.filter(s => s.completed).length || 0;
              const taskProgress = subtasksTotal > 0 ? (subtasksDone / subtasksTotal) : (t.status === 'en-proceso' ? 0.5 : 0);
              
              const endDate = new Date(t.endDate);
              const daysLeft = Math.ceil((endDate.getTime() - todayDate.getTime()) / (1000 * 3600 * 24));
              
              let statusText = "";
              if (taskProgress === 0 && daysLeft <= 1) {
                statusText = "🚨 *¡Aún no has comenzado!* Estamos al límite.";
              } else if (taskProgress < 0.5 && daysLeft <= 1) {
                statusText = "⚠️ *No terminarás a este ritmo.* Necesitas ayuda?";
              } else if (t.endDate < todayStr) {
                statusText = `🚫 *VENCIDA hace ${Math.abs(daysLeft)} días.*`;
              } else {
                statusText = `⏳ Quedan ${daysLeft} días (${Math.round(taskProgress * 100)}% avance)`;
              }

              const priorityEmoji = t.priority === 'muy-alto' ? '🔥' : '📍';
              message += `  ${priorityEmoji} *${t.title}*\n      └ ${statusText}\n`;
            });
            message += `\n`;
          });
          
          message += `🎯 *MISIÓN DEL DÍA:* Priorizar las tareas en riesgo alto antes que cualquier otra cosa. 🚀\n\n`;
        } else {
          message += `✅ *¡Felicidades equipo!* El proyecto marcha sobre ruedas. Sigan así. 💎\n\n`;
        }

        const scrumTips = [
          "Prioriza la tarea más compleja primero. ☀️",
          "Recuerda: Hecho es mejor que perfecto. ✅",
          "Eliminar distracciones es ganar tiempo. 📵",
          "Comparte tus bloqueos a tiempo con el equipo. 🗣️"
        ];
        const randomTip = scrumTips[Math.floor(Math.random() * scrumTips.length)];
        message += `💡 *Tip del Scrum Master:* ${randomTip}`;

        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        });

        addToast("¡ScrumBot ha analizado el proyecto y enviado el reporte! 📊✅", "success");
      } catch (directError: any) {
        console.error(directError);
        addToast("Error al enviar monitoreo (Servidor y Cliente fallaron).", "error");
      }
    }
  };

  const handleTestTelegram = async () => {
    if (!selectedProject) return;
    try {
      // Usar los valores del proyecto o los globales como respaldo definitivo
      const botToken = (selectedProject.telegramBotToken && selectedProject.telegramBotToken.length > 40) 
        ? selectedProject.telegramBotToken 
        : BOT_TOKEN;
      const chatId = selectedProject.telegramChatId || CHAT_ID;
      
      addToast("Probando conexión directa con Telegram... 📡");

      // CAMBIO: Llamada directa desde el cliente para evitar errores de servidor/proxy
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: "✅ *Conexión Directa Exitosa*\nEl bot de Gestor JMAI está configurado correctamente desde el cliente. 🚀",
        parse_mode: 'Markdown'
      });
      
      addToast("¡Mensaje de prueba enviado exitosamente! 📢", "success");
    } catch (error: any) {
      console.error("Error directo de Telegram:", error.response?.data || error.message);
      const errorMsg = error.response?.data?.description || error.message || "Error al conectar con Telegram.";
      addToast(`Error: ${errorMsg}`, "error");
    }
  };

  const handleRepairConfig = () => {
    if (!selectedProject) return;
    const repairedProject = {
      ...selectedProject,
      telegramBotToken: BOT_TOKEN,
      telegramChatId: CHAT_ID
    };
    setSelectedProject(repairedProject);
    setProjects(prev => prev.map(p => p.id === selectedProject.id ? repairedProject : p));
    addToast("Configuración reparada con valores por defecto 🛠️");
  };

  // REPARACION DE DATOS: Migrar tareas de la llave antigua a la nueva
  const repairLocalData = () => {
    try {
      const oldTasks = localStorage.getItem("local-tasks");
      if (oldTasks) {
        const parsed = JSON.parse(oldTasks);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log("Migrando tareas antiguas...");
          const currentLocalTasks = localStorage.getItem(`local-tasks-local-proj`);
          const existing = currentLocalTasks ? JSON.parse(currentLocalTasks) : [];
          const existingIds = new Set(existing.map((t: any) => t.id));
          const newTasks = parsed.filter((t: any) => !existingIds.has(t.id));
          
          const finalTasks = [...existing, ...newTasks];
          localStorage.setItem(`local-tasks-local-proj`, JSON.stringify(finalTasks));
          localStorage.removeItem("local-tasks");
          
          // Forzar recarga de proyectos para que aparezca "Proyecto JMAI (Local)"
          window.location.reload(); 
          addToast(`¡Recuperadas ${newTasks.length} tareas! Selecciona el Proyecto Local para verlas. 🚀`);
        }
      } else {
        addToast("No se encontraron datos antiguos para reparar ✅");
      }
    } catch (err) {
      console.error("Error reparando datos:", err);
      addToast("Error al reparar datos", "error");
    }
  };

  const syncTasksToCloud = async () => {
    if (!selectedProject || selectedProject.id === "local-proj") {
      addToast("Selecciona un proyecto de la nube como destino primero.", "error");
      return;
    }

    const localTasksStr = localStorage.getItem("local-tasks-local-proj");
    if (!localTasksStr) {
      addToast("No hay tareas locales para sincronizar.", "error");
      return;
    }

    const localTasks = JSON.parse(localTasksStr);
    if (localTasks.length === 0) {
      addToast("No hay tareas locales para sincronizar.", "error");
      return;
    }

    addToast(`Sincronizando ${localTasks.length} tareas a la nube... ☁️`);
    
    try {
      let count = 0;
      for (const task of localTasks) {
        const { id, ...cleanTask } = task; // Quitar ID local
        await addDoc(collection(db, `projects/${selectedProject.id}/tasks`), {
          ...cleanTask,
          projectId: selectedProject.id,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
        count++;
      }
      
      // Limpiar local storage tras éxito
      localStorage.removeItem("local-tasks-local-proj");
      addToast(`¡Éxito! ${count} tareas subidas a ${selectedProject.name} ✅`, "success");
      
      // Actualizar vista
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      console.error("Error sincronizando:", err);
      addToast(`Error: ${err.message}`, "error");
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: Task['status']) => {
    if (!selectedProject) return;
    try {
      if (selectedProject.id !== "local-proj") {
        const taskRef = doc(db, `projects/${selectedProject.id}/tasks`, taskId);
        await updateDoc(taskRef, { status: newStatus, updatedAt: Timestamp.now() });
      } else {
        const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t);
        setTasks(updatedTasks);
        localStorage.setItem(`local-tasks-${selectedProject.id}`, JSON.stringify(updatedTasks));
      }
      addToast(`Estado actualizado a ${newStatus} ✅`);
    } catch (err) {
      console.error("Error al actualizar estado:", err);
      addToast("Error al actualizar estado", "error");
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    
    const taskData = {
      ...taskForm,
      status: "pendiente",
      projectId: selectedProject.id,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };

    try {
      if (editingTask) {
        if (selectedProject.id !== "local-proj") {
          const taskRef = doc(db, `projects/${selectedProject.id}/tasks`, editingTask.id);
          await updateDoc(taskRef, taskData);
        } else {
          const updatedTasks = tasks.map(t => t.id === editingTask.id ? { ...t, ...taskData, id: t.id } : t);
          setTasks(updatedTasks);
          localStorage.setItem(`local-tasks-${selectedProject.id}`, JSON.stringify(updatedTasks));
        }
        addToast("Tarea actualizada ✅");
      } else {
        if (selectedProject.id !== "local-proj") {
          await addDoc(collection(db, `projects/${selectedProject.id}/tasks`), {
            ...taskData,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });
        } else {
          const newTask = { 
            ...taskData, 
            id: Math.random().toString(36).substr(2, 9), 
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          const updatedTasks = [...tasks, newTask];
          setTasks(updatedTasks);
          localStorage.setItem(`local-tasks-${selectedProject.id}`, JSON.stringify(updatedTasks));
        }
        addToast("Tarea creada ✅");
      }
      
      setShowTaskModal(false);
      setEditingTask(null);
      setTaskForm({ 
        title: "", 
        description: "", 
        responsible: "", 
        telegramUsername: "", 
        priority: "media", 
        startDate: format(new Date(), "yyyy-MM-dd"), 
        endDate: format(new Date(), "yyyy-MM-dd"),
        subtasks: [],
        estimatedDays: 1
      });
    } catch (err: any) {
      console.error("Error al guardar tarea:", err);
      addToast("Error al guardar tarea: " + (err.message || "Error desconocido"), "error");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!selectedProject || !window.confirm("¿Estás seguro de eliminar esta tarea? 🗑️")) return;
    
    try {
      if (selectedProject.id !== "local-proj") {
        const taskRef = doc(db, `projects/${selectedProject.id}/tasks`, taskId);
        await deleteDoc(taskRef);
      } else {
        const updatedTasks = tasks.filter(t => t.id !== taskId);
        setTasks(updatedTasks);
        localStorage.setItem(`local-tasks-${selectedProject.id}`, JSON.stringify(updatedTasks));
      }
      addToast("Tarea eliminada ✅");
    } catch (err) {
      console.error("Error al eliminar tarea:", err);
      addToast("Error al eliminar tarea", "error");
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const newProject: Project = {
      ...projectForm,
      id: Math.random().toString(36).substr(2, 9),
      ownerId: "default_user"
    };

    try {
      await addDoc(collection(db, "projects"), {
        ...projectForm,
        ownerId: "default_user"
      });
      addToast("Proyecto creado en la nube ✅");
    } catch (err) {
      console.warn("Error guardando en Firestore, guardando localmente:", err);
      const updatedProjects = [...projects, newProject];
      setProjects(updatedProjects);
      localStorage.setItem("local-projects", JSON.stringify(updatedProjects));
      addToast("Proyecto creado localmente ✅");
    }
    
    setShowProjectModal(false);
    setProjectForm({ name: "", description: "", telegramBotToken: BOT_TOKEN, telegramChatId: CHAT_ID });
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    try {
      if (selectedProject.id !== "local-proj") {
        const projectRef = doc(db, "projects", selectedProject.id);
        await updateDoc(projectRef, {
          telegramBotToken: selectedProject.telegramBotToken,
          telegramChatId: selectedProject.telegramChatId
        });
        addToast("Ajustes actualizados en nube ✅");
      } else {
        const updated = projects.map(p => p.id === selectedProject.id ? selectedProject : p);
        setProjects(updated);
        localStorage.setItem("local-projects", JSON.stringify(updated));
        addToast("Ajustes guardados localmente ✅");
      }
    } catch (err) {
      console.error(err);
      addToast("Error al guardar ajustes.", "error");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProject) return;

    const reader = new FileReader();

    if (file.name.endsWith(".csv")) {
      Papa.parse(file, {
        header: true,
        complete: async (results) => {
          await importTasks(results.data);
        }
      });
    } else {
      reader.onload = async (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);
        await importTasks(json);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const importTasks = async (data: any[]) => {
    if (!selectedProject) return;
    try {
      const batch = data.map(item => {
        // Normalize status
        let statusInput = (item.status || item.Estado || "pendiente").toString().toLowerCase().trim();
        const statusMap: Record<string, Task['status']> = {
          'pendiente': 'pendiente', 'en proceso': 'en-proceso', 'en-proceso': 'en-proceso', 
          'completado': 'completado', 'finalizado': 'completado', 'terminado': 'completado',
          'urgente': 'urgente', 'retrasado': 'urgente'
        };
        const status = statusMap[statusInput] || 'pendiente';

        // Normalize priority
        let priorityInput = (item.priority || item.Prioridad || "media").toString().toLowerCase().trim();
        const priorityMap: Record<string, Task['priority']> = {
          'baja': 'baja', 'media': 'media', 'alta': 'alta', 'muy alto': 'muy-alto', 'urgente': 'muy-alto'
        };
        const priority = priorityMap[priorityInput] || 'media';

        return {
          id: Math.random().toString(36).substr(2, 9),
          title: item.Actividad || item.title || item.Título || "Sin Título",
          description: `${item.Curso ? `[Curso: ${item.Curso}] ` : ""}${item.Fase ? `(Fase: ${item.Fase}) ` : ""}${item.description || item.Descripción || ""}${item['Duracion dias'] ? `\nDuración: ${item['Duracion dias']} días` : ""}${item['Dias Restantes'] ? `\nRestan: ${item['Dias Restantes']} días` : ""}`,
          responsible: item.Responsable || item.responsible || "Sin Asignar",
          status,
          priority,
          startDate: item['Fecha Inicio'] || item.startDate || format(new Date(), "yyyy-MM-dd"),
          endDate: item['Fecha Fin'] || item.endDate || format(new Date(), "yyyy-MM-dd"),
          projectId: selectedProject.id,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
      });

      if (selectedProject.id === "local-proj") {
        const newTasks = [...tasks, ...batch];
        setTasks(newTasks);
        localStorage.setItem("local-tasks", JSON.stringify(newTasks));
      } else {
        for (const task of batch) {
          await addDoc(collection(db, `projects/${selectedProject.id}/tasks`), task);
        }
      }
      
      addToast(`¡Se importaron ${batch.length} tareas! ✅`);
      setShowImportModal(false);
    } catch (error) {
      console.error(error);
      addToast("Error al importar tareas ❌", "error");
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Gestor JMAI
          </h1>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'kanban', icon: Trello, label: 'Kanban' },
            { id: 'metrics', icon: BarChart3, label: 'Métricas' },
            { id: 'settings', icon: Settings, label: 'Ajustes' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-indigo-50 text-indigo-600 font-semibold shadow-sm' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 mt-auto border-t border-slate-100">
          <div className="bg-slate-900 rounded-2xl p-4 text-white">
            <p className="text-xs text-slate-400 mb-1">Proyecto Activo</p>
            <select 
              className="bg-transparent text-sm font-bold w-full focus:outline-none"
              value={selectedProject?.id || ""}
              onChange={(e) => {
                if (e.target.value === "new") {
                  setShowProjectModal(true);
                } else {
                  setSelectedProject(projects.find(p => p.id === e.target.value) || null);
                }
              }}
            >
              {projects.map(p => <option key={p.id} value={p.id} className="text-slate-900">{p.name}</option>)}
              <option value="new" className="text-slate-900">+ Nuevo Proyecto</option>
            </select>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Buscar tareas..." 
                className="w-full bg-slate-100 border-none rounded-full pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={handleRunMonitoring}
              className="p-2.5 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-90 tooltip"
              title="Disparar Monitoreo Telegram"
            >
              <Send size={20} />
            </button>
            <button 
              onClick={() => setShowImportModal(true)}
              className="btn-secondary"
              title="Importar CSV/Excel"
            >
              <Upload size={20} />
              Importar
            </button>
            <button 
              onClick={() => {
                setEditingTask(null);
                setTaskForm({
                  title: "",
                  description: "",
                  responsible: "",
                  priority: "media",
                  startDate: format(new Date(), "yyyy-MM-dd"),
                  endDate: format(new Date(), "yyyy-MM-dd")
                });
                setShowTaskModal(true);
              }}
              className="btn-primary"
            >
              <Plus size={20} />
              Nueva Tarea
            </button>
          </div>
        </header>

        {/* Tab Views */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Dashboard Filters Bar */}
                <div className="glass-card p-4 flex flex-wrap items-center gap-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-slate-400" />
                    <select 
                      className="text-xs font-bold text-slate-600 bg-transparent outline-none cursor-pointer border-r pr-4 border-slate-100"
                      value={filterResponsible}
                      onChange={(e) => setFilterResponsible(e.target.value)}
                    >
                      <option value="Todos">RESPONSABLE: Todos</option>
                      {Array.from(new Set(tasks.map(t => t.responsible))).map((r: string) => (
                        <option key={r} value={r}>{r.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-slate-400" />
                    <select 
                      className="text-xs font-bold text-slate-600 bg-transparent outline-none cursor-pointer border-r pr-4 border-slate-100"
                      value={filterPriority}
                      onChange={(e) => setFilterPriority(e.target.value)}
                    >
                      <option value="Todas">PRIORIDAD: Todas</option>
                      <option value="muy-alto">🚨 MUY ALTO</option>
                      <option value="alta">ALTA</option>
                      <option value="media">MEDIA</option>
                      <option value="baja">BAJA</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Trello size={14} className="text-slate-400" />
                    <select 
                      className="text-xs font-bold text-slate-600 bg-transparent outline-none cursor-pointer border-r pr-4 border-slate-100"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="Todos">ESTADO: Todos</option>
                      <option value="pendiente">PENDIENTE</option>
                      <option value="en-proceso">EN PROCESO</option>
                      <option value="completado">COMPLETADO</option>
                      <option value="urgente">URGENTE</option>
                      <option value="descartado">DESCARTADO</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-slate-400" />
                    <select 
                      className="text-xs font-bold text-slate-600 bg-transparent outline-none cursor-pointer"
                      value={sortByDate || ""}
                      onChange={(e) => setSortByDate(e.target.value as any || null)}
                    >
                      <option value="">ORDENAR POR FECHA</option>
                      <option value="asc">Próximos a vencer 🔜</option>
                      <option value="desc">Más lejanos 📅</option>
                    </select>
                  </div>

                  <div className="flex-1" />
                  
                  <button 
                    onClick={() => {
                      setFilterResponsible('Todos');
                      setFilterPriority('Todas');
                      setFilterStatus('Todos');
                      setSortByDate(null);
                      setSearchQuery("");
                    }}
                    className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest transition-colors"
                  >
                    Limpiar Filtros
                  </button>
                </div>

                {/* Dashboard KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="glass-card p-4 flex flex-col border-l-4 border-slate-300">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Pendientes</span>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-black text-slate-700">{filteredTasks.filter(t => t.status === 'pendiente').length}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mb-1" />
                    </div>
                  </div>
                  <div className="glass-card p-4 flex flex-col border-l-4 border-blue-500">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">En Proceso</span>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-black text-slate-700">{filteredTasks.filter(t => t.status === 'en-proceso').length}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mb-1" />
                    </div>
                  </div>
                  <div className="glass-card p-4 flex flex-col border-l-4 border-rose-500">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Urgentes</span>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-black text-slate-700">{filteredTasks.filter(t => t.priority === 'muy-alto').length}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mb-1" />
                    </div>
                  </div>
                  <div className="glass-card p-4 flex flex-col border-l-4 border-emerald-500">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Completadas</span>
                    <div className="flex items-end justify-between">
                      <span className="text-2xl font-black text-slate-700">{filteredTasks.filter(t => t.status === 'completado').length}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mb-1" />
                    </div>
                  </div>
                </div>

                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Actividad</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsable</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estado</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Progreso</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Prioridad</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fin</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Detalles</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredTasks
                          .map(task => (
                            <tr key={task.id} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-800 text-sm">{task.title}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px] font-bold border border-indigo-100 uppercase">
                                  {task.responsible.charAt(0)}
                                </div>
                                <span className="text-xs font-semibold text-slate-600">{task.responsible}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <select 
                                value={task.status}
                                onChange={(e) => updateTaskStatus(task.id, e.target.value as any)}
                                className={`text-[10px] font-bold px-2 py-1 rounded-lg border-none outline-none cursor-pointer transition-all ${
                                  task.status === 'completado' ? 'bg-emerald-50 text-emerald-600' :
                                  task.status === 'en-proceso' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                <option value="pendiente">PENDIENTE</option>
                                <option value="en-proceso">EN PROCESO</option>
                                <option value="completado">COMPLETADO</option>
                                <option value="urgente">URGENTE</option>
                                <option value="descartado">DESCARTADO</option>
                              </select>
                            </td>
                            <td className="px-6 py-4 min-w-[120px]">
                              {task.subtasks && task.subtasks.length > 0 ? (
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[8px] font-bold text-slate-400">
                                     <span>{Math.round((task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100)}%</span>
                                  </div>
                                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full transition-all duration-500 ${
                                        (task.subtasks.filter(s => s.completed).length / task.subtasks.length) > 0.8 ? 'bg-emerald-500' : 
                                        (task.subtasks.filter(s => s.completed).length / task.subtasks.length) > 0.4 ? 'bg-blue-500' : 'bg-indigo-400'
                                      }`}
                                      style={{ width: `${(task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[9px] text-slate-300 italic">Sin subtareas</span>
                              )}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`text-[10px] font-bold flex items-center gap-1.5 ${
                                task.priority === 'muy-alto' ? 'text-rose-600' :
                                task.priority === 'alta' ? 'text-orange-500' : 'text-slate-400'
                              }`}>
                                {task.priority === 'muy-alto' && <AlertCircle size={12} />}
                                {task.priority.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-[11px] font-medium text-slate-500">
                              {task.endDate}
                            </td>
                            <td className="px-6 py-4">
                              <button 
                                onClick={() => {
                                  setEditingTask(task);
                                  setTaskForm({
                                    title: task.title,
                                    description: task.description,
                                    responsible: task.responsible,
                                    telegramUsername: task.telegramUsername || "",
                                    priority: task.priority,
                                    startDate: task.startDate || format(new Date(), "yyyy-MM-dd"),
                                    endDate: task.endDate,
                                    subtasks: task.subtasks || [],
                                    estimatedDays: task.estimatedDays || 1
                                  });
                                  setShowTaskModal(true);
                                }}
                                className="text-[11px] text-indigo-400 hover:text-indigo-600 underline decoration-indigo-200 underline-offset-4"
                              >
                                Detalles...
                              </button>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => {
                                    setEditingTask(task);
                                    setTaskForm({
                                      title: task.title,
                                      description: task.description,
                                      responsible: task.responsible,
                                      telegramUsername: task.telegramUsername || "",
                                      priority: task.priority,
                                      startDate: task.startDate || format(new Date(), "yyyy-MM-dd"),
                                      endDate: task.endDate,
                                      subtasks: task.subtasks || [],
                                      estimatedDays: task.estimatedDays || 1
                                    });
                                    setShowTaskModal(true);
                                  }}
                                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition-colors"
                                  title="Editar"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteTask(task.id)}
                                  className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition-colors"
                                  title="Eliminar"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

            {activeTab === 'kanban' && (
              <motion.div 
                key="kanban"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex gap-6 h-full min-w-max pb-4"
              >
                {['pendiente', 'en-proceso', 'completado'].map(status => (
                  <div key={status} className="w-80 flex flex-col gap-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="uppercase text-xs font-bold text-slate-500 tracking-widest">{status}</h3>
                      <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                        {tasks.filter(t => t.status === status).length}
                      </span>
                    </div>
                    <div className="kanban-column flex-1 overflow-y-auto scrollbar-hide space-y-3">
                      {tasks.filter(t => t.status === status).map(task => (
                        <motion.div 
                          layout
                          key={task.id} 
                          className="kanban-card group"
                          whileHover={{ scale: 1.02 }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md ${
                              task.priority === 'muy-alto' ? 'bg-red-100 text-red-600' : 
                              task.priority === 'alta' ? 'bg-orange-100 text-orange-600' :
                              'bg-green-100 text-green-600'
                            }`}>
                              {task.priority}
                            </span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {status !== 'pendiente' && <button onClick={() => updateTaskStatus(task.id, status === 'en-proceso' ? 'pendiente' : 'en-proceso')} className="p-1 hover:bg-slate-100 rounded text-slate-400"><CheckCircle2 size={12} className="rotate-180" /></button>}
                              {status !== 'completado' && <button onClick={() => updateTaskStatus(task.id, status === 'pendiente' ? 'en-proceso' : 'completado')} className="p-1 hover:bg-slate-100 rounded text-indigo-500"><CheckCircle2 size={12} /></button>}
                            </div>
                          </div>
                          <h4 className="font-semibold text-slate-800 mb-1 cursor-pointer hover:text-indigo-600" onClick={() => {
                            setEditingTask(task);
                            setTaskForm({
                              title: task.title,
                              description: task.description,
                              responsible: task.responsible,
                              telegramUsername: task.telegramUsername || "",
                              priority: task.priority,
                              startDate: task.startDate || format(new Date(), "yyyy-MM-dd"),
                              endDate: task.endDate
                            });
                            setShowTaskModal(true);
                          }}>{task.title}</h4>
                          <p className="text-[11px] text-slate-500 line-clamp-2 mb-3 leading-relaxed">{task.description}</p>
                          <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <Calendar size={12} />
                              <span className="text-[10px] font-medium">{task.endDate}</span>
                            </div>
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 border border-white flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-sm">
                              {task.responsible.charAt(0)}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === 'metrics' && (
              <motion.div 
                key="metrics"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <KPIStat label="Total Tareas" value={filteredTasks.length} color="indigo" />
                  <KPIStat label="En Proceso" value={filteredTasks.filter(t => t.status === 'en-proceso').length} color="blue" />
                  <KPIStat label="Completado" value={filteredTasks.filter(t => t.status === 'completado').length} color="emerald" />
                  <KPIStat label="Urgentes" value={filteredTasks.filter(t => t.priority === 'muy-alto').length} color="rose" />
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="glass-card p-6">
                    <h3 className="text-lg mb-6 flex items-center gap-2"><Trello className="text-indigo-500" /> Distribución por Estado</h3>
                    <div className="h-64 flex items-end justify-around gap-4 px-4">
                      {['pendiente', 'en-proceso', 'completado'].map(s => {
                        const count = filteredTasks.filter(t => t.status === s).length;
                        const height = filteredTasks.length > 0 ? (count / filteredTasks.length) * 100 : 0;
                        return (
                          <div key={s} className="flex flex-col items-center gap-4 w-full">
                            <div 
                              className={`w-12 rounded-t-lg transition-all duration-700 ${
                                s === 'pendiente' ? 'bg-slate-400' : 
                                s === 'en-proceso' ? 'bg-blue-500' : 'bg-emerald-500'
                              }`} 
                              style={{ height: `${height}%`, minHeight: '8px' }}
                            />
                            <span className="text-[10px] uppercase font-bold text-slate-500">{s}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="glass-card p-6">
                    <h3 className="text-lg mb-6 flex items-center gap-2"><User className="text-indigo-500" /> Carga por Responsable</h3>
                    <div className="space-y-4">
                      {Array.from(new Set(filteredTasks.map(t => t.responsible))).map(resp => {
                        const count = filteredTasks.filter(t => t.responsible === resp).length;
                        return (
                          <div key={resp}>
                            <div className="flex justify-between text-xs font-bold mb-1.5 uppercase tracking-wide text-slate-600">
                              <span>{resp}</span>
                              <span>{count} tareas</span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-indigo-500 rounded-full" 
                                style={{ width: `${(count / filteredTasks.length) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div key="settings" className="space-y-6">
                <div className="max-w-2xl mx-auto glass-card p-8">
                  <h3 className="text-xl mb-8">Ajustes del Proyecto</h3>
                  <form onSubmit={handleUpdateSettings} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormGroup 
                        label="Bot Token (Telegram)" 
                        value={selectedProject?.telegramBotToken} 
                        onChange={(val) => selectedProject && setSelectedProject({...selectedProject, telegramBotToken: val})}
                      />
                      <FormGroup 
                        label="Chat ID" 
                        value={selectedProject?.telegramChatId} 
                        onChange={(val) => selectedProject && setSelectedProject({...selectedProject, telegramChatId: val})}
                      />
                    </div>
                    <div className="pt-4 flex justify-end gap-3 italic text-[10px] text-slate-400">
                      * Si los campos están vacíos, se usará el Bot JMAI por defecto.
                    </div>
                    <div className="pt-2 flex justify-end gap-3">
                      <button 
                        type="button" 
                        onClick={handleRepairConfig}
                        className="px-4 py-2 text-xs font-bold text-amber-600 hover:bg-amber-50 rounded-lg transition-colors border border-amber-200"
                      >
                        Reparar con Bot JMAI 🛠️
                      </button>
                      <button 
                        type="button" 
                        onClick={handleTestTelegram}
                        className="btn-secondary"
                      >
                        Probar Conexión
                      </button>
                      <button type="submit" className="btn-primary shadow-lg shadow-indigo-100">Guardar Configuración</button>
                    </div>
                  </form>
                </div>

                <div className="max-w-2xl mx-auto glass-card p-8 border-l-4 border-indigo-500">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-indigo-50 text-indigo-500 rounded-2xl shadow-sm"><Send /></div>
                    <div>
                      <h3 className="text-xl font-black text-indigo-600">Sincronización Cloud</h3>
                      <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Migrar Datos a Firebase</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                    Si tienes tareas en el proyecto local, puedes subirlas definitivamente al proyecto de Firebase seleccionado.
                  </p>
                  <button 
                    onClick={syncTasksToCloud}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 shadow-xl"
                  >
                    ☁️ SUBIR TAREAS LOCALES A LA NUBE (FIREBASE)
                  </button>
                </div>

                <div className="max-w-2xl mx-auto glass-card p-8 border-l-4 border-rose-500">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-rose-50 text-rose-500 rounded-2xl shadow-sm"><AlertCircle /></div>
                    <div>
                      <h3 className="text-xl font-black text-rose-600">⚠ Modo Rescate Activado</h3>
                      <p className="text-xs text-rose-400 font-bold uppercase tracking-widest">Recuperación de Actividades</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                    Si tu dashboard está vacío pero tenías tareas antes, es probable que estén en el almacenamiento antiguo. 
                    Pulsa el botón de abajo para traerlas de vuelta al proyecto actual.
                  </p>
                  <button 
                    onClick={repairLocalData}
                    className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 transition-all flex items-center justify-center gap-3 shadow-xl"
                  >
                    🚀 REPARAR Y RECUPERAR MIS TAREAS
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Task Modal (Placeholder for Create/Edit) */}
      <AnimatePresence>
        {showTaskModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setShowTaskModal(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-xl shadow-2xl p-8 relative z-10"
            >
              <h2 className="text-2xl font-bold mb-6">{editingTask ? "Editar Tarea" : "Nueva Tarea"}</h2>
              <form className="space-y-4" onSubmit={handleCreateTask}>
                <input 
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500" 
                  placeholder="Título de la tarea" 
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({...taskForm, title: e.target.value})}
                />
                <textarea 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 h-24 resize-none outline-none focus:ring-2 focus:ring-indigo-500" 
                  placeholder="Descripción..." 
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({...taskForm, description: e.target.value})}
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup label="Responsable" value={taskForm.responsible} onChange={(val) => setTaskForm({...taskForm, responsible: val})} />
                  <FormGroup label="Telegram Username (sin @)" value={taskForm.telegramUsername} onChange={(val) => setTaskForm({...taskForm, telegramUsername: val})} />
                </div>
                
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-2 tracking-wide">Prioridad</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3"
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({...taskForm, priority: e.target.value as any})}
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                    <option value="muy-alto">🚨 Muy Alto</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-2 mb-1 block">Inicio</label>
                    <input 
                      type="date" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3" 
                      value={taskForm.startDate}
                      onChange={(e) => setTaskForm({...taskForm, startDate: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Días Estimados</label>
                    <div className="flex gap-2">
                      <input 
                        type="number"
                        value={taskForm.estimatedDays}
                        onChange={(e) => setTaskForm({...taskForm, estimatedDays: parseInt(e.target.value)})}
                        className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all w-full"
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          const sugg = getAISuggestions(taskForm.title);
                          const newEndDate = new Date(taskForm.startDate || new Date());
                          newEndDate.setDate(newEndDate.getDate() + sugg.days);
                          setTaskForm({
                            ...taskForm, 
                            estimatedDays: sugg.days,
                            endDate: format(newEndDate, "yyyy-MM-dd")
                          });
                        }}
                        className="px-3 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-colors uppercase whitespace-nowrap"
                      >
                        IA Suggest ✨
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Fecha de Fin</label>
                    <input 
                      type="date"
                      value={taskForm.endDate}
                      onChange={(e) => setTaskForm({...taskForm, endDate: e.target.value})}
                      className="bg-slate-50 border border-slate-100 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all w-full"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-end">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Subtareas (Checklist)</label>
                    <button 
                      type="button"
                      onClick={() => {
                        const sugg = getAISuggestions(taskForm.title);
                        const newSubtasks = sugg.subtasks.map(s => ({
                          id: Math.random().toString(36).substr(2, 9),
                          text: s,
                          completed: false
                        }));
                        setTaskForm({...taskForm, subtasks: [...taskForm.subtasks, ...newSubtasks]});
                      }}
                      className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest"
                    >
                      ✨ Sugerir con IA
                    </button>
                  </div>
                  
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {Array.isArray(taskForm.subtasks) && taskForm.subtasks.map((st, idx) => (
                      <div key={st.id} className="flex items-center gap-3 bg-slate-50 p-2 rounded-lg group">
                        <input 
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => {
                            const newST = [...taskForm.subtasks];
                            newST[idx].completed = !newST[idx].completed;
                            setTaskForm({...taskForm, subtasks: newST});
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <input 
                          type="text"
                          value={st.text}
                          onChange={(e) => {
                            const newST = [...taskForm.subtasks];
                            newST[idx].text = e.target.value;
                            setTaskForm({...taskForm, subtasks: newST});
                          }}
                          className="bg-transparent border-none outline-none text-xs text-slate-600 flex-1"
                        />
                        <button 
                          type="button" 
                          onClick={() => setTaskForm({...taskForm, subtasks: taskForm.subtasks.filter((_, i) => i !== idx)})}
                          className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button 
                    type="button"
                    onClick={() => setTaskForm({
                      ...taskForm, 
                      subtasks: [...taskForm.subtasks, { id: Math.random().toString(36).substr(2, 9), text: "", completed: false }]
                    })}
                    className="w-full py-2 border-2 border-dashed border-slate-100 rounded-lg text-[10px] font-bold text-slate-400 hover:border-slate-200 hover:text-slate-500 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus size={14} /> Añadir Subtarea Manual
                  </button>
                </div>

                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setShowTaskModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
                  <button type="submit" className="btn-primary flex-1 justify-center">{editingTask ? "Guardar Cambios" : "Crear Tarea"}</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Project Modal */}
      <AnimatePresence>
        {showProjectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowProjectModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 relative z-10" >
              <h2 className="text-2xl font-bold mb-6">Nuevo Proyecto</h2>
              <form className="space-y-4" onSubmit={handleCreateProject}>
                <input required className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500 font-semibold" placeholder="Nombre del Proyecto" value={projectForm.name} onChange={(e) => setProjectForm({...projectForm, name: e.target.value})} />
                <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 h-20 resize-none outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Descripción corta..." value={projectForm.description} onChange={(e) => setProjectForm({...projectForm, description: e.target.value})} />
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setShowProjectModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
                  <button type="submit" className="btn-primary w-full justify-center">Guardar Cambios</button>
                </div>
              </form>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowImportModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 relative z-10" >
              <h2 className="text-2xl font-bold mb-4">Importar Tareas</h2>
              <p className="text-sm text-slate-500 mb-6">Sube un archivo CSV o Excel con las columnas:<br/>
              <code className="text-[10px] bg-slate-100 p-1 rounded">ID, Curso, Fase, Actividad, Responsable, Estado, Prioridad, Fecha Inicio, Fecha Fin</code></p>
              
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 hover:border-indigo-400 transition-colors cursor-pointer relative">
                <Upload size={32} className="text-slate-300" />
                <span className="text-sm font-medium text-slate-500">Haz clic para seleccionar archivo</span>
                <input 
                  type="file" 
                  accept=".csv, .xlsx" 
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                  onChange={handleFileUpload}
                />
              </div>

              <div className="mt-8 flex gap-4">
                <button type="button" onClick={() => setShowImportModal(false)} className="btn-secondary flex-1 justify-center">Cerrar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[100]">
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className={`px-4 py-3 rounded-xl shadow-xl border flex items-center gap-3 min-w-[200px] ${
                toast.type === 'success' ? 'bg-white border-emerald-100 text-emerald-600' : 'bg-white border-rose-100 text-rose-600'
              }`}
            >
              <div className={`p-1 rounded-full ${toast.type === 'success' ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              </div>
              <span className="text-sm font-semibold">{toast.message}</span>
            </motion.div>
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
}

// Helper Components
function TaskCard({ task, onStatusChange, onEdit }: { 
  task: Task, 
  onStatusChange: (taskId: string, newStatus: Task['status']) => Promise<void> | void, 
  onEdit: () => void 
}) {
  return (
    <motion.div 
      layout
      className="glass-card p-6 flex flex-col group"
      whileHover={{ y: -4, shadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)" }}
    >
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2 rounded-lg ${
          task.status === 'completado' ? 'bg-emerald-100 text-emerald-600' :
          task.priority === 'muy-alto' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'
        }`}>
          {task.status === 'completado' ? <CheckCircle2 size={20} /> : 
           task.priority === 'muy-alto' ? <AlertCircle size={20} /> : <Clock size={20} />}
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"><MessageSquare size={16} /></button>
          <button className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"><Paperclip size={16} /></button>
        </div>
      </div>
      
      <h3 className="font-bold text-lg mb-2 text-slate-800 leading-tight cursor-pointer hover:text-indigo-600 transition-colors" onClick={onEdit}>{task.title}</h3>
      <p className="text-slate-500 text-sm mb-6 line-clamp-3 flex-1">{task.description}</p>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <User size={14} className="text-slate-400" />
            {task.responsible}
          </div>
          <div className="text-slate-400 font-medium">Vence {task.endDate}</div>
        </div>

        <div className="flex items-center gap-2">
          {task.status !== 'completado' ? (
            <button 
              onClick={() => onStatusChange(task.id, 'completado')}
              className="flex-1 bg-emerald-50 text-emerald-600 font-bold py-2 rounded-lg hover:bg-emerald-100 transition-colors text-xs flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={14} /> Completar
            </button>
          ) : (
            <button 
              onClick={() => onStatusChange(task.id, 'pendiente')}
              className="flex-1 bg-slate-100 text-slate-600 font-bold py-2 rounded-lg hover:bg-slate-200 transition-colors text-xs"
            >
              Reabrir
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function KPIStat({ label, value, color }: { label: string, value: number, color: string }) {
  const colors: any = {
    indigo: 'from-indigo-500 to-indigo-600 text-indigo-500 bg-indigo-50',
    blue: 'from-blue-500 to-blue-600 text-blue-500 bg-blue-50',
    emerald: 'from-emerald-500 to-emerald-600 text-emerald-500 bg-emerald-50',
    rose: 'from-rose-500 to-rose-600 text-rose-500 bg-rose-50'
  };
  
  return (
    <div className="glass-card p-6 flex flex-col text-center">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</span>
      <span className={`text-3xl font-black ${colors[color].split(' ')[1]}`}>{value}</span>
    </div>
  );
}

function FormGroup({ label, value, onChange }: { label: string, value?: string, onChange?: (val: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-bold text-slate-500 uppercase ml-2 tracking-wide">{label}</label>
      <input 
        type="text" 
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-sm font-medium" 
      />
    </div>
  );
}
