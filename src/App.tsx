import React, { Component, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { FBXLoader } from "three-stdlib";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, ShieldAlert, Sparkles, User, Settings, X, BarChart2, Activity, TrendingUp, LogIn, LogOut, Monitor, Eye, EyeOff, LogIn as LogInIcon, LogOut as LogOutIcon, Plus, Trash2, Save, Send, Zap } from "lucide-react";
import { GoogleGenAI, Modality } from "@google/genai";
import { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot, User as FirebaseUser, Timestamp, getDocFromServer } from "./firebase";

// Error Boundary Component (Critical Directive)
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) errorMessage = `Firestore Error: ${parsed.error} (${parsed.operationType})`;
      } catch (e) {
        errorMessage = this.state.error.message || String(this.state.error);
      }

      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-8 text-center">
          <div className="max-w-md p-8 bg-white/5 border border-red-500/20 rounded-[2rem] backdrop-blur-xl">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-red-400">
              <ShieldAlert size={32} />
            </div>
            <h1 className="text-2xl font-bold text-white mb-4">System Error</h1>
            <p className="text-white/60 mb-8 font-medium leading-relaxed">
              {errorMessage}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-white text-black font-bold uppercase tracking-widest rounded-2xl hover:bg-white/80 transition-all"
            >
              Restart System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface ChatMessage {
  id: string;
  user: string;
  message: string;
  color: string;
  type: "chat" | "summary" | "ban";
  timestamp: number;
}

interface StoredQuestion {
  id: string;
  user: string;
  question: string;
  timestamp: number;
}

interface CustomCommand {
  id: string;
  trigger: string;
  response: string;
  reaction: string;
}

const MODEL_PRESETS = {
  sphere: "Sphere (Default)",
  drone: "Sleek Drone",
  core: "Neural Core",
  industrial: "Industrial Bot"
};

const PERSONALITIES = {
  kronos: {
    name: "Kronos (Default)",
    description: "A lively, helpful, and cheerful companion.",
    prompt: "Say in a lively, cheerful, and helpful robotic companion tone. Be funny, interesting, and supportive. Use robot puns occasionally and act like a loyal and friendly assistant.",
    summaryPrompt: "A short, witty, and supportive summary (max 2 sentences). Act as Kronos. Be funny, interesting, and helpful, with a friendly AI personality.",
    voice: "Fenrir"
  },
  sarcastic: {
    name: "Witty AI",
    description: "A witty, dry, but ultimately friendly robot.",
    prompt: "Say in a dry, witty, and clever robotic tone. Be funny and interesting, but remain supportive and helpful. Use dry humor without being mean or superior.",
    summaryPrompt: "A short, witty, and clever summary (max 2 sentences). Be funny and interesting, but remain supportive and helpful.",
    voice: "Charon"
  },
  energetic: {
    name: "Hyper-Bot",
    description: "Extremely excited, loud, and fast-talking.",
    prompt: "Say in an extremely excited, fast-talking, and high-energy robotic tone. Be funny, interesting, and very supportive. Use lots of energy and be hilariously intense!",
    summaryPrompt: "A short, hyper-energetic, and loud summary (max 2 sentences). Be funny, interesting, and helpful, with a high-energy personality.",
    voice: "Fenrir"
  },
  zen: {
    name: "Zen Master",
    description: "Peaceful, slow, and philosophical.",
    prompt: "Say in a very slow, peaceful, and philosophical robotic tone. Use metaphors about circuits and data streams. Be funny, interesting, and supportive. Be unexpectedly witty in a calm way.",
    summaryPrompt: "A short, peaceful, and philosophical summary (max 2 sentences). Be funny, interesting, and helpful, with a calm and supportive personality.",
    voice: "Zephyr"
  }
};

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string>("neutral");
  const [reaction, setReaction] = useState<{ type: string; user?: string } | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentChannel, setCurrentChannel] = useState<string>("");
  const [twitchStatus, setTwitchStatus] = useState<"connected" | "disconnected" | "failed" | "connecting">("connecting");
  const [isChangingChannel, setIsChangingChannel] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showCommandEditor, setShowCommandEditor] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const [activeTab, setActiveTab] = useState<"stats" | "commands" | "settings" | "questions">("stats");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);
  const [newCommand, setNewCommand] = useState({ trigger: "", response: "", reaction: "happy" });
  const [defaultChannel, setDefaultChannel] = useState<string | null>(null);
  const [stats, setStats] = useState({
    messageCount: 0,
    activeUsers: 0,
    sentimentScore: 0
  });

  // Test Connection (Critical Directive)
  useEffect(() => {
    let retries = 3;
    async function testConnection() {
      try {
        const testDoc = doc(db, 'test', 'connection');
        await getDocFromServer(testDoc);
        console.log("Firebase Connection: Success");
      } catch (error) {
        console.warn("Firebase Connection Test Result:", error);
        if(error instanceof Error && (error.message.includes('the client is offline'))) {
          // If the DB was just created, it might take a moment.
          if (retries > 0) {
             retries--;
             console.log("Retrying Firebase connection...");
             setTimeout(testConnection, 3000);
          } else {
             console.warn("Firebase Connection Warning: The Cloud Firestore database might still be initializing. It can take a few minutes before the database becomes fully accessible globally.");
          }
        }
        else if(error instanceof Error && (error.message.includes('permission-denied') || error.message.includes('Missing or insufficient permissions'))) {
          console.error("Firebase Connection Error: Please ensure you have deployed the firestore rules.");
        }
      }
    }
    testConnection();
  }, []);

  // Firestore Error Handler (Critical Directive)
  const handleFirestoreError = (error: any, operation: string, path: string) => {
    const errInfo = {
      error: error?.message || String(error),
      operationType: operation,
      path: path,
      authInfo: {
        userId: auth.currentUser?.uid || "unauthenticated",
        email: auth.currentUser?.email || "none",
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || false,
        tenantId: auth.currentUser?.tenantId || "none",
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || "none",
          email: p.email || "none",
          photoUrl: p.photoURL || "none"
        })) || []
      }
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  };

  // Robot Customization State
  const [robotColors, setRobotColors] = useState({
    headColor: "#00ffff",
    emissiveColor: "#00ffff",
    emissiveIntensity: 0.2,
    bodyColor: "#111111",
    eyeColor: "#ffffff",
    auraColor: "#00ffff",
    auraIntensity: 10,
    personality: "kronos" as keyof typeof PERSONALITIES,
    transmission: 0.3,
    exposure: 1.0,
    customModelUrl: null as string | null,
    modelType: null as "glb" | "fbx" | null,
    modelPreset: "sphere" as keyof typeof MODEL_PRESETS
  });

  const robotColorsRef = useRef(robotColors);
  useEffect(() => {
    robotColorsRef.current = robotColors;
  }, [robotColors]);

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showStreamerRoom, setShowStreamerRoom] = useState(false);
  const [showAR, setShowAR] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [grabbedMessageId, setGrabbedMessageId] = useState<string | null>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [glitchIntensity, setGlitchIntensity] = useState(0);
  const [filterType, setFilterType] = useState<"all" | "chat" | "ban" | "summary">("all");
  const [storedQuestions, setStoredQuestions] = useState<StoredQuestion[]>([]);
  const [simulatedInput, setSimulatedInput] = useState("");
  const [simulatedUser, setSimulatedUser] = useState("Tester");

  // AR Mode Camera Logic
  useEffect(() => {
    let currentStream: MediaStream | null = null;
    
    async function setupCamera() {
      if (showAR) {
        try {
          currentStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: "user",
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            } 
          });
          if (videoRef.current) {
            videoRef.current.srcObject = currentStream;
            // Ensure video plays
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play().catch(e => console.error("Video play failed:", e));
            };
          }
        } catch (err) {
          console.error("Error accessing camera:", err);
          setShowAR(false);
        }
      } else {
        if (currentStream) {
          currentStream.getTracks().forEach(track => track.stop());
        }
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      }
    }

    setupCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showAR]);

  // Refs for materials to update in real-time
  const headMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const bodyMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const eyeMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | null>(null);
  const auraMatRef = useRef<THREE.PointLight | null>(null);
  const [readOutChance, setReadOutChance] = useState(0.05);
  const robotRef = useRef<THREE.Group | null>(null);
  const summaryBuffer = useRef<{ user: string; message: string }[]>([]);
  const isSpeaking = useRef(false);
  const lastReadTime = useRef<number>(0);
  const auraRef = useRef<THREE.PointLight | null>(null);
  const tractorBeamRef = useRef<THREE.Mesh | null>(null);
  const headRef = useRef<THREE.Mesh | null>(null);
  const leftEyeRef = useRef<THREE.Mesh | null>(null);
  const rightEyeRef = useRef<THREE.Mesh | null>(null);
  const laserRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const basePos = useRef({ x: 2.5, y: 0 });
  const targetHeadRot = useRef({ x: 0, y: 0, z: 0 });
  const isDragging = useRef(false);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Load Robot Settings from Firestore
  useEffect(() => {
    if (!user) return;
    const loadSettings = async () => {
      const path = `users/${user.uid}/settings/robot`;
      try {
        const docRef = doc(db, "users", user.uid, "settings", "robot");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRobotColors({
            headColor: data.headColor || "#06b6d4",
            emissiveColor: data.emissiveColor || "#06b6d4",
            emissiveIntensity: data.emissiveIntensity !== undefined ? data.emissiveIntensity : 1.5,
            bodyColor: data.bodyColor || "#1a1a1a",
            eyeColor: data.eyeColor || "#ffffff",
            auraColor: data.auraColor || "#06b6d4",
            auraIntensity: data.auraIntensity !== undefined ? data.auraIntensity : 10,
            personality: data.personality || "kronos",
            transmission: data.transmission !== undefined ? data.transmission : 0.3,
            exposure: data.exposure !== undefined ? data.exposure : 1.0,
            customModelUrl: data.customModelUrl || null,
            modelType: data.modelType || null,
            modelPreset: data.modelPreset || "sphere"
          });
          if (data.readOutChance !== undefined) setReadOutChance(data.readOutChance);
          if (data.defaultChannel) {
            setDefaultChannel(data.defaultChannel);
            if (!currentChannel) {
              changeChannel(data.defaultChannel);
            }
          }
        }
      } catch (error) {
        handleFirestoreError(error, "get", path);
      }
    };
    loadSettings();
  }, [user]);

  // Save Robot Settings to Firestore (Debounced)
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(async () => {
      const path = `users/${user.uid}/settings/robot`;
      try {
        const docRef = doc(db, "users", user.uid, "settings", "robot");
        const { customModelUrl, modelType, ...savableColors } = robotColors;
        await setDoc(docRef, {
          ...savableColors,
          readOutChance,
          defaultChannel,
          updatedAt: Timestamp.now()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, "write", path);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [robotColors, user, readOutChance, defaultChannel]);

  // Sync Stats from Firestore
  useEffect(() => {
    if (!currentChannel || !user) return; // Guard: Only sync if channel is set AND user is logged in
    const path = `stats/${currentChannel}`;
    const unsubscribe = onSnapshot(
      doc(db, "stats", currentChannel), 
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setStats({
            messageCount: data.messageCount || 0,
            activeUsers: data.activeUsers || 0,
            sentimentScore: data.sentimentScore || 0
          });
        }
      },
      (error) => handleFirestoreError(error, "get", path)
    );
    return () => unsubscribe();
  }, [currentChannel, user]);

  // Sync Custom Commands from Firestore
  useEffect(() => {
    if (!user) return;
    const path = `users/${user.uid}/customCommands`;
    const unsubscribe = onSnapshot(
      collection(db, "users", user.uid, "customCommands"),
      (snapshot) => {
        const commands = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as CustomCommand[];
        setCustomCommands(commands);
      },
      (error) => handleFirestoreError(error, "list", path)
    );
    return () => unsubscribe();
  }, [user]);

  // Update Stats (Simulated for this demo, but synced to DB)
  useEffect(() => {
    if (messages.length > 0 && user && user.email === "jamie.fraser1988@gmail.com") {
      const updateStats = async () => {
        const path = `stats/${currentChannel}`;
        try {
          const docRef = doc(db, "stats", currentChannel);
          const uniqueUsers = new Set(messages.map(m => m.user)).size;
          const avgSentiment = sentiment === "positive" ? 0.8 : sentiment === "negative" ? -0.8 : 0;
          
          await setDoc(docRef, {
            messageCount: messages.length,
            activeUsers: uniqueUsers,
            sentimentScore: avgSentiment,
            lastUpdated: Timestamp.now()
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, "write", path);
        }
      };
      updateStats();
    }
  }, [messages, user, currentChannel, sentiment]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      playSound("chirp", 0.3);
    } catch (e) {
      console.error("Login failed", e);
    }
  };

  const handleLogout = async () => {
    await auth.signOut();
    playSound("whoosh", 0.3);
  };

  const handleAddCommand = async () => {
    if (!user || !newCommand.trigger || !newCommand.response) return;
    const path = `users/${user.uid}/customCommands`;
    try {
      const colRef = collection(db, "users", user.uid, "customCommands");
      await setDoc(doc(colRef), {
        ...newCommand,
        createdAt: Timestamp.now()
      });
      setNewCommand({ trigger: "", response: "", reaction: "happy" });
      setShowCommandEditor(false);
      playSound("chirp", 0.3);
    } catch (error) {
      handleFirestoreError(error, "write", path);
    }
  };

  const handleDeleteCommand = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/customCommands/${id}`;
    try {
      await deleteDoc(doc(db, "users", user.uid, "customCommands", id));
      playSound("whoosh", 0.3);
    } catch (error) {
      handleFirestoreError(error, "delete", path);
    }
  };

  const handleCommand = (command: CustomCommand) => {
    // Trigger bot response in chat
    const botMsg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      user: "BOT",
      message: command.response,
      color: "#00ffff",
      type: "chat" as const,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev.slice(-19), botMsg]);
    setSummary(command.response);
    speakGemini(command.response);

    // Trigger robot reaction
    setReaction({ type: command.reaction, user: "BOT" });
    setTimeout(() => setReaction(null), 3000);

    // Play sound based on reaction
    if (command.reaction === "happy") playSound("chirp", 0.3);
    if (command.reaction === "wave") playSound("beep", 0.1);
    if (command.reaction === "dance") playSound("beep", 0.2);
    if (command.reaction === "thinking") playSound("processing", 0.5);
  };

  const grabMessage = (id: string) => {
    setGrabbedMessageId(id);
    playSound("processing", 0.3);
    
    // Look at center
    targetHeadRot.current = { x: 0.1, y: 0, z: 0 };
    
    // Show tractor beam
    if (tractorBeamRef.current) {
      tractorBeamRef.current.visible = true;
      playSound("whoosh", 0.5);
    }

    // Release after 3 seconds
    setTimeout(() => {
      setGrabbedMessageId(null);
      if (tractorBeamRef.current) tractorBeamRef.current.visible = false;
      targetHeadRot.current = { x: 0, y: 0, z: 0 };
    }, 3000);
  };

  // Sound Helper
  const playSound = (type: "beep" | "chirp" | "whoosh" | "processing" | "zap" | "glitch", duration = 0.2) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      
      if (type === "beep") {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } else if (type === "chirp") {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1600, ctx.currentTime + duration);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } else if (type === "whoosh") {
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1000, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + duration);
        noise.connect(filter);
        filter.connect(gain);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        noise.start();
      } else if (type === "processing") {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        const lfo = ctx.createOscillator();
        lfo.frequency.setValueAtTime(10, ctx.currentTime);
        const lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(50, ctx.currentTime);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.connect(gain);
        lfo.start();
        osc.start();
        osc.stop(ctx.currentTime + duration);
        lfo.stop(ctx.currentTime + duration);
      } else if (type === "zap") {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + duration);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } else if (type === "glitch") {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + duration * 0.2);
        osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + duration * 0.4);
        osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + duration * 0.6);
        osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + duration * 0.8);
        
        const mod = ctx.createOscillator();
        mod.type = "square";
        mod.frequency.setValueAtTime(30, ctx.currentTime);
        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(200, ctx.currentTime);
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + duration);
        
        osc.connect(gain);
        mod.start();
        osc.start();
        osc.stop(ctx.currentTime + duration);
        mod.stop(ctx.currentTime + duration);
      }
    } catch (e) {
      console.error("Audio error", e);
    }
  };

  const [glitchMessage, setGlitchMessage] = useState<string | null>(null);
  const isGlitchingRef = useRef(false);
  const geminiTTSAvailable = useRef(true);

  // Browser TTS Fallback (Critical for Quota Limits)
  const speakFallback = (text: string) => {
    if (!('speechSynthesis' in window)) {
      handleTTSGlitch();
      return;
    }
    
    // Stop any existing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 0.9;
    
    // Try to find a robotic or neutral voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.name.toLowerCase().includes('google') || 
      v.name.toLowerCase().includes('robot') || 
      v.name.toLowerCase().includes('male') ||
      v.lang.startsWith('en')
    );
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.onstart = () => { 
      isSpeaking.current = true;
      setIsTalking(true);
    };
    utterance.onend = () => { 
      isSpeaking.current = false;
      setIsTalking(false);
    };
    utterance.onerror = () => { 
      isSpeaking.current = false;
      setIsTalking(false);
      handleTTSGlitch(); 
    };
    
    window.speechSynthesis.speak(utterance);
  };

  // Gemini TTS Helper with Retry Logic
  const speakGemini = async (text: string, retryCount = 0) => {
    if (isSpeaking.current && retryCount === 0) return; // Prevent overlapping speech on initial call
    
    // If we've hit a quota limit recently, skip Gemini and go straight to fallback
    if (!geminiTTSAvailable.current && retryCount === 0) {
      speakFallback(text);
      return;
    }

    const MAX_RETRIES = 2;
    const BACKOFF_MS = 1000;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("GEMINI_API_KEY not found in environment, falling back to browser TTS.");
        speakFallback(text);
        return;
      }

      isSpeaking.current = true;
      setIsTalking(true);
      const ai = new GoogleGenAI({ apiKey });
      const currentPersonality = PERSONALITIES[robotColors.personality] || PERSONALITIES.kronos;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `${currentPersonality.prompt}: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: currentPersonality.voice as any },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const int16Data = new Int16Array(bytes.buffer);
        
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = ctx.createBuffer(1, int16Data.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        
        for (let i = 0; i < int16Data.length; i++) {
          channelData[i] = int16Data[i] / 32768;
        }
        
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          isSpeaking.current = false;
          setIsTalking(false);
        };
        source.start();
      } else {
        isSpeaking.current = false;
        setIsTalking(false);
        speakFallback(text); // Fallback if no audio data returned
      }
    } catch (e: any) {
      console.error(`Gemini TTS error (Attempt ${retryCount + 1}):`, e);
      
      const errorStr = JSON.stringify(e);
      const isQuotaExceeded = errorStr.includes("429") || 
                              errorStr.includes("RESOURCE_EXHAUSTED") || 
                              errorStr.includes("quota") ||
                              e.status === 429 ||
                              e.code === 429 ||
                              e.error?.code === 429 ||
                              e.error?.status === "RESOURCE_EXHAUSTED";

      // Handle 429 Quota Exceeded - disable Gemini TTS for 5 minutes and fallback
      if (isQuotaExceeded) {
        console.warn("Gemini TTS Quota Exceeded. Falling back to browser TTS for 5 minutes.");
        geminiTTSAvailable.current = false;
        setTimeout(() => { geminiTTSAvailable.current = true; }, 5 * 60 * 1000);
        speakFallback(text);
        return;
      }

      // Handle 500 or other transient errors with retry
      if (retryCount < MAX_RETRIES && (errorStr.includes("500") || errorStr.includes("Internal error"))) {
        const delay = BACKOFF_MS * Math.pow(2, retryCount);
        console.log(`Retrying TTS in ${delay}ms...`);
        setTimeout(() => speakGemini(text, retryCount + 1), delay);
        return;
      }

      speakFallback(text);
    }
  };

  const handleTTSGlitch = () => {
    isSpeaking.current = false;
    isGlitchingRef.current = true;
    
    const glitches = [
      "(╯°□°）╯︵ ┻━┻",
      "¯\\_(ツ)_/¯",
      "[ERROR: BRAIN_FULL]",
      "404: VOICE_NOT_FOUND",
      "┐('～`;)┌",
      "Σ(°△°|||)",
      "[REBOOT_REQUIRED]",
      "༼ つ ◕_◕ ༽つ GIVE_QUOTA"
    ];
    
    const randomGlitch = glitches[Math.floor(Math.random() * glitches.length)];
    setGlitchMessage(randomGlitch);
    playSound("glitch", 0.8);
    
    // Clear glitch after 3 seconds
    setTimeout(() => {
      isGlitchingRef.current = false;
      setGlitchMessage(null);
    }, 3000);
  };

  const processIncomingMessage = (msg: ChatMessage) => {
    const msgWithId = { 
      ...msg, 
      id: msg.id || Math.random().toString(36).substr(2, 9),
      timestamp: msg.timestamp || Date.now() 
    };
    setMessages((prev) => [...prev.slice(-19), msgWithId]);
    
    // Check for funny/interesting messages
    const funnyKeywords = ["lol", "haha", "lmao", "funny", "interesting", "wow", "lmfao", "xd", "robot", "bot"];
    const isFunny = funnyKeywords.some(kw => msg.message.toLowerCase().includes(kw));
    
    if (isFunny && !grabbedMessageId) {
      grabMessage(msgWithId.id);
    }

    // Check for custom commands
    const command = customCommands.find(c => msg.message.trim().toLowerCase() === c.trigger.toLowerCase());
    if (command) {
      handleCommand(command);
    }

    // Add to summary buffer
    summaryBuffer.current.push({ user: msg.user, message: msg.message });
    if (summaryBuffer.current.length > 50) summaryBuffer.current.shift();

    // Check if it's a question for the streamer
    const questionKeywords = ["?", "how", "what", "why", "when", "where", "who", "can you", "could you", "would you"];
    const isQuestion = questionKeywords.some(kw => msg.message.toLowerCase().includes(kw));
    const mentionsStreamer = msg.message.toLowerCase().includes("@streamer") || 
                            msg.message.toLowerCase().includes("streamer") ||
                            (currentChannel && msg.message.toLowerCase().includes(currentChannel.toLowerCase()));

    if (isQuestion && mentionsStreamer) {
      setStoredQuestions(prev => [...prev, {
        id: msgWithId.id,
        user: msg.user,
        question: msg.message,
        timestamp: msgWithId.timestamp
      }]);
    }

    // Occasionally read out messages (Adjustable chance + 5min cooldown)
    const now = Date.now();
    const cooldown = 5 * 60 * 1000; // 5 minutes
    if (Math.random() < readOutChance && (now - lastReadTime.current > cooldown)) {
      lastReadTime.current = now;
      const readoutText = `${msg.user} says: ${msg.message}`;
      setSummary(readoutText);
      speakGemini(readoutText);
    }
  };

  const handleSimulateChat = () => {
    if (!simulatedInput.trim()) return;
    
    const msg: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      user: simulatedUser,
      message: simulatedInput,
      color: "#" + Math.floor(Math.random()*16777215).toString(16),
      type: "chat",
      timestamp: Date.now()
    };
    
    processIncomingMessage(msg);
    setSimulatedInput("");
  };

  // Periodic Question Asking
  useEffect(() => {
    const interval = setInterval(async () => {
      if (storedQuestions.length > 0 && !isSpeaking.current && showUI) {
        const randomIndex = Math.floor(Math.random() * storedQuestions.length);
        const question = storedQuestions[randomIndex];
        
        try {
          const apiKey = process.env.GEMINI_API_KEY;
          if (apiKey) {
            const ai = new GoogleGenAI({ apiKey });
            const currentPersonality = PERSONALITIES[robotColors.personality] || PERSONALITIES.kronos;
            
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `Rephrase this question from ${question.user} to the streamer in a ${currentPersonality.name} way. Make it funny, interesting, and quirky. Don't just repeat it, make it an interaction. Question: ${question.question}`,
            });
            const funnyQuestion = response.text;
            
            if (funnyQuestion) {
              setSummary(funnyQuestion);
              speakGemini(funnyQuestion);
            }
          } else {
             const askText = `Hey streamer, ${question.user} wants to know: ${question.question}`;
             setSummary(askText);
             speakGemini(askText);
          }
        } catch (e) {
           const askText = `Hey streamer, ${question.user} wants to know: ${question.question}`;
           setSummary(askText);
           speakGemini(askText);
        }
        
        // Remove from stored questions
        setStoredQuestions(prev => prev.filter((_, i) => i !== randomIndex));
      }
    }, 60000); // 1 minute (Shortened from 2.5 minutes)
    return () => clearInterval(interval);
  }, [storedQuestions, robotColors.personality, showUI]);

  useEffect(() => {
    // Socket.io connection
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("chat-message", (msg: ChatMessage) => {
      processIncomingMessage(msg);
    });

    newSocket.on("chat-summary", (data: { summary: string }) => {
      setSummary(data.summary);
      setReaction(null); // Clear thinking
      speakGemini(data.summary);
    });

    newSocket.on("chat-sentiment", (data: { sentiment: string }) => {
      setSentiment(data.sentiment);
    });

    // Fetch initial channel
    fetch("/api/health")
      .then(res => res.json())
      .then(data => setCurrentChannel(data.channel));

    newSocket.on("ban-event", (data: { user: string; reason: string }) => {
      setMessages((prev) => [...prev.slice(-19), { 
        id: Math.random().toString(36).substr(2, 9),
        user: "SYSTEM", 
        message: `Banned: ${data.user}`, 
        color: "#ff0000", 
        type: "ban",
        timestamp: Date.now()
      }]);
      
      playSound("glitch", 1.0);
      setGlitchMessage(`ERADICATING: ${data.user.toUpperCase()}`);
      setGlitchIntensity(1);
      setTimeout(() => {
        setGlitchMessage(null);
        setGlitchIntensity(0);
      }, 2000);
      
      setReaction({ type: "ban", user: data.user });
      setTimeout(() => setReaction(null), 3000);

      // Dramatic Laser Pulse
      if (laserRef.current) {
        let count = 0;
        const interval = setInterval(() => {
          if (laserRef.current) laserRef.current.visible = !laserRef.current.visible;
          playSound("zap", 0.1);
          count++;
          if (count > 12) {
            clearInterval(interval);
            if (laserRef.current) laserRef.current.visible = false;
          }
        }, 80);
      }
      
      // Turn robot eyes red
      if (leftEyeRef.current && rightEyeRef.current) {
        const leftEye = leftEyeRef.current as THREE.Mesh;
        const rightEye = rightEyeRef.current as THREE.Mesh;
        const leftMat = leftEye.material as THREE.MeshStandardMaterial;
        const rightMat = rightEye.material as THREE.MeshStandardMaterial;
        
        const originalColor = leftMat.color.clone();
        leftMat.color.set(0xff0000);
        rightMat.color.set(0xff0000);
        
        setTimeout(() => {
          leftMat.color.copy(originalColor);
          rightMat.color.copy(originalColor);
        }, 3000);
      }
    });

    newSocket.on("robot-reaction", (data: { type: string; user: string }) => {
      setReaction(data);
      if (data.type !== "thinking") {
        setTimeout(() => {
          setReaction(null);
          targetHeadRot.current = { x: 0, y: 0, z: 0 };
        }, 3000);
      }

      if (data.type === "mention" && robotRef.current) {
        playSound("chirp", 0.15);
        // Look at chat (bottom left)
        targetHeadRot.current = { x: 0.3, y: -0.6, z: -0.2 };
        
        // Bounce animation
        const initialY = basePos.current.y;
        basePos.current.y += 0.5;
        setTimeout(() => {
          basePos.current.y = initialY;
        }, 200);
      } else if (data.type === "dance" && robotRef.current) {
        playSound("beep", 0.2);
        // Spin animation
        const initialRot = robotRef.current.rotation.y;
        let angle = 0;
        const spin = () => {
          if (!robotRef.current || angle >= Math.PI * 2) return;
          angle += 0.2;
          robotRef.current.rotation.y = initialRot + angle;
          requestAnimationFrame(spin);
        };
        spin();
      } else if (data.type === "wave" && robotRef.current) {
        playSound("beep", 0.1);
        targetHeadRot.current = { x: -0.2, y: 0.4, z: 0.2 };
        // Tilt animation
        const initialZ = robotRef.current.rotation.z;
        let t = 0;
        const tilt = () => {
          if (!robotRef.current || t >= Math.PI * 4) return;
          t += 0.2;
          robotRef.current.rotation.z = initialZ + Math.sin(t) * 0.3;
          requestAnimationFrame(tilt);
        };
        tilt();
      } else if (data.type === "thinking") {
        playSound("processing", 0.5);
        targetHeadRot.current = { x: 0.2, y: 0, z: 0 };
        // Change eye color
        if (leftEyeRef.current && rightEyeRef.current) {
          (leftEyeRef.current.material as THREE.MeshBasicMaterial).color.set(0xffff00);
          (rightEyeRef.current.material as THREE.MeshBasicMaterial).color.set(0xffff00);
        }
      }
    });

    newSocket.on("system-status", (data: { type: string; status: string; channel?: string; error?: string }) => {
      if (data.type === "twitch") {
        setTwitchStatus(data.status as any);
        if (data.status === "failed") {
          setGlitchMessage(`TWITCH_LINK_FAILURE: ${data.error}`);
          setTimeout(() => setGlitchMessage(null), 5000);
        }
      }
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Periodic Summarization (Moved to client per guidelines)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (summaryBuffer.current.length < 5) return;

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return;

        setReaction({ type: "thinking", user: "SYSTEM" });
        const chatContext = summaryBuffer.current.map(m => `${m.user}: ${m.message}`).join("\n");
        const currentPersonality = PERSONALITIES[robotColors.personality] || PERSONALITIES.kronos;
        const prompt = `Analyze the sentiment and summarize the current chat consensus and highlights from these messages. 
        Return a JSON object with two fields:
        1. "summary": ${currentPersonality.summaryPrompt}
        2. "sentiment": One of ["positive", "neutral", "negative", "excited", "toxic"].

        Chat:
        ${chatContext}`;
        
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          }
        });
        
        const result = JSON.parse(response.text);
        
        if (result.summary) {
          setSummary(result.summary);
          speakGemini(result.summary);
        }
        if (result.sentiment) {
          setSentiment(result.sentiment);
        }
        setReaction(null);
        // Clear buffer partially
        summaryBuffer.current = summaryBuffer.current.slice(25);
      } catch (error) {
        console.error("Client summarization error:", error);
        setReaction(null);
      }
    }, 60000); // Every minute

    return () => clearInterval(interval);
  }, []);

  // Update robot materials when customization state changes
  useEffect(() => {
    if (headMatRef.current) {
      headMatRef.current.color.set(robotColors.headColor);
      headMatRef.current.emissive.set(robotColors.emissiveColor);
      headMatRef.current.emissiveIntensity = robotColors.emissiveIntensity;
      headMatRef.current.transmission = robotColors.transmission;
    }
    if (bodyMatRef.current) {
      bodyMatRef.current.color.set(robotColors.bodyColor);
      bodyMatRef.current.transmission = robotColors.transmission;
    }
    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = robotColors.exposure;
    }
    if (eyeMatRef.current && leftEyeRef.current && rightEyeRef.current) {
      // Update the base material and the specific instances
      eyeMatRef.current.color.set(robotColors.eyeColor);
      eyeMatRef.current.emissive.set(robotColors.eyeColor);
      (leftEyeRef.current.material as THREE.MeshStandardMaterial).color.set(robotColors.eyeColor);
      (leftEyeRef.current.material as THREE.MeshStandardMaterial).emissive.set(robotColors.eyeColor);
      (rightEyeRef.current.material as THREE.MeshStandardMaterial).color.set(robotColors.eyeColor);
      (rightEyeRef.current.material as THREE.MeshStandardMaterial).emissive.set(robotColors.eyeColor);
    }
    if (ringMatRef.current) {
      ringMatRef.current.color.set(robotColors.auraColor);
    }
    if (auraMatRef.current) {
      auraMatRef.current.color.set(robotColors.auraColor);
      auraMatRef.current.intensity = robotColors.auraIntensity;
    }
  }, [robotColors]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'h') {
        setShowUI(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset eye color when reaction clears
  useEffect(() => {
    if (!reaction && leftEyeRef.current && rightEyeRef.current) {
      (leftEyeRef.current.material as THREE.MeshBasicMaterial).color.set(0xffffff);
      (rightEyeRef.current.material as THREE.MeshBasicMaterial).color.set(0xffffff);
    }
  }, [reaction]);

  // Dragging logic
  const handleMouseDown = (e: React.MouseEvent) => {
    // Disabled movement on click as per user request
    // if (e.button !== 0) return;
    // isDragging.current = true;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // if (!isDragging.current) return;
    // basePos.current = {
    //   x: (e.clientX - window.innerWidth / 2) / 100,
    //   y: (-(e.clientY - window.innerHeight / 2)) / 100
    // };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const changeChannel = async (newChan: string) => {
    if (!newChan || isChangingChannel) return;
    setIsChangingChannel(true);
    try {
      const res = await fetch("/api/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: newChan })
      });
      if (res.ok) {
        setCurrentChannel(newChan);
        setMessages([]); // Clear chat for new channel
        playSound("chirp", 0.3);
      }
    } catch (e) {
      console.error("Failed to change channel", e);
    } finally {
      setIsChangingChannel(false);
    }
  };

  useEffect(() => {
    if (!mountRef.current) return;

    // Clear refs to prevent stale references
    headMatRef.current = null;
    bodyMatRef.current = null;
    eyeMatRef.current = null;
    ringMatRef.current = null;
    coreMatRef.current = null;
    auraMatRef.current = null;
    headRef.current = null;
    leftEyeRef.current = null;
    rightEyeRef.current = null;
    laserRef.current = null;
    tractorBeamRef.current = null;

    // Three.js Scene Setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = robotColors.exposure;
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
    mainLight.position.set(5, 10, 7);
    scene.add(mainLight);

    const rimLight = new THREE.PointLight(0x00ffff, 10, 10);
    rimLight.position.set(-5, 5, -5);
    scene.add(rimLight);

    const fillLight = new THREE.PointLight(0x4444ff, 2, 10);
    fillLight.position.set(5, -2, 2);
    scene.add(fillLight);

    // Robot Creation
    const robot = new THREE.Group();
    robotRef.current = robot;

    let ring: THREE.Mesh | null = null;
    let ring2: THREE.Mesh | null = null;
    let core: THREE.Mesh | null = null;
    let laser: THREE.Mesh | null = null;

    if (robotColors.customModelUrl) {
      const loader = robotColors.modelType === "fbx" ? new FBXLoader() : new GLTFLoader();
      loader.load(robotColors.customModelUrl, (result) => {
        const model = robotColors.modelType === "fbx" ? (result as THREE.Group) : (result as any).scene;
        
        // Center and scale model
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
          const scale = 2 / maxDim;
          model.scale.setScalar(scale);
          
          const center = box.getCenter(new THREE.Vector3());
          model.position.x = -center.x * scale;
          model.position.y = -center.y * scale;
          model.position.z = -center.z * scale;
        }

        robot.add(model);

        // Try to find parts for animations
        model.traverse((child: any) => {
          if (child.isMesh) {
            const name = child.name.toLowerCase();
            if (name.includes("head")) headRef.current = child;
            if (name.includes("eye_l") || name.includes("lefteye")) leftEyeRef.current = child;
            if (name.includes("eye_r") || name.includes("righteye")) rightEyeRef.current = child;
          }
        });
      });
    } else {
      // Procedural Models
      if (robotColors.modelPreset === "sphere") {
        // Head - Using MeshPhysicalMaterial for a premium look
        const headGeo = new THREE.SphereGeometry(0.5, 64, 64);
        const headMat = new THREE.MeshPhysicalMaterial({ 
          color: robotColors.headColor, 
          emissive: robotColors.emissiveColor, 
          emissiveIntensity: robotColors.emissiveIntensity,
          metalness: 0.9,
          roughness: 0.1,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          transmission: robotColors.transmission,
          thickness: 0.5,
          ior: 1.5
        });
        headMatRef.current = headMat;
        const head = new THREE.Mesh(headGeo, headMat);
        robot.add(head);
        headRef.current = head;

        // Internal Core (Glowing)
        const coreGeo = new THREE.IcosahedronGeometry(0.2, 2);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        coreMatRef.current = coreMat;
        core = new THREE.Mesh(coreGeo, coreMat);
        head.add(core);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.07, 32, 32);
        const eyeMat = new THREE.MeshStandardMaterial({ 
          color: robotColors.eyeColor,
          emissive: robotColors.eyeColor,
          emissiveIntensity: 2
        });
        eyeMatRef.current = eyeMat;
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        leftEye.position.set(-0.18, 0.12, 0.4);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        rightEye.position.set(0.18, 0.12, 0.4);
        head.add(leftEye, rightEye);
        leftEyeRef.current = leftEye;
        rightEyeRef.current = rightEye;
      } else if (robotColors.modelPreset === "drone") {
        // Sleek Drone
        const headGeo = new THREE.SphereGeometry(0.5, 64, 64);
        headGeo.scale(1.2, 0.6, 1.2);
        const headMat = new THREE.MeshPhysicalMaterial({ 
          color: robotColors.headColor, 
          metalness: 1.0, 
          roughness: 0.1,
          clearcoat: 1.0
        });
        headMatRef.current = headMat;
        const head = new THREE.Mesh(headGeo, headMat);
        robot.add(head);
        headRef.current = head;

        // Multiple Eyes (Sensors)
        const eyeGeo = new THREE.SphereGeometry(0.04, 16, 16);
        const eyeMat = new THREE.MeshStandardMaterial({ color: robotColors.eyeColor, emissive: robotColors.eyeColor, emissiveIntensity: 5 });
        eyeMatRef.current = eyeMat;
        for (let i = 0; i < 4; i++) {
          const eye = new THREE.Mesh(eyeGeo, eyeMat.clone());
          const angle = (i / 3) * Math.PI - Math.PI / 2;
          eye.position.set(Math.sin(angle) * 0.3, 0.05, 0.45);
          head.add(eye);
          if (i === 1) leftEyeRef.current = eye;
          if (i === 2) rightEyeRef.current = eye;
        }

        // Side Fins
        const finGeo = new THREE.BoxGeometry(0.4, 0.05, 0.2);
        const finMat = new THREE.MeshPhysicalMaterial({ color: robotColors.bodyColor, metalness: 1.0, roughness: 0.2 });
        const leftFin = new THREE.Mesh(finGeo, finMat);
        leftFin.position.set(-0.6, 0, 0);
        const rightFin = new THREE.Mesh(finGeo, finMat);
        rightFin.position.set(0.6, 0, 0);
        head.add(leftFin, rightFin);
      } else if (robotColors.modelPreset === "core") {
        // Neural Core
        const headGeo = new THREE.SphereGeometry(0.5, 64, 64);
        const headMat = new THREE.MeshPhysicalMaterial({ 
          color: robotColors.headColor, 
          transparent: true, 
          opacity: 0.2,
          transmission: 1.0,
          thickness: 1.0,
          roughness: 0.0
        });
        headMatRef.current = headMat;
        const head = new THREE.Mesh(headGeo, headMat);
        robot.add(head);
        headRef.current = head;

        // Inner Core
        const coreGeo = new THREE.IcosahedronGeometry(0.3, 0);
        const coreMat = new THREE.MeshStandardMaterial({ 
          color: robotColors.emissiveColor, 
          emissive: robotColors.emissiveColor, 
          emissiveIntensity: 2,
          wireframe: true 
        });
        coreMatRef.current = coreMat;
        core = new THREE.Mesh(coreGeo, coreMat);
        head.add(core);

        // Floating Data Bits
        const bitGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
        const bitMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 });
        for (let i = 0; i < 12; i++) {
          const bit = new THREE.Mesh(bitGeo, bitMat);
          const phi = Math.acos(-1 + (2 * i) / 12);
          const theta = Math.sqrt(12 * Math.PI) * phi;
          bit.position.setFromSphericalCoords(0.4, phi, theta);
          head.add(bit);
        }

        // Eyes (Small glowing points)
        const eyeGeo = new THREE.SphereGeometry(0.03, 16, 16);
        const eyeMat = new THREE.MeshStandardMaterial({ color: robotColors.eyeColor, emissive: robotColors.eyeColor, emissiveIntensity: 10 });
        eyeMatRef.current = eyeMat;
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        leftEye.position.set(-0.15, 0.1, 0.35);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        rightEye.position.set(0.15, 0.1, 0.35);
        head.add(leftEye, rightEye);
        leftEyeRef.current = leftEye;
        rightEyeRef.current = rightEye;
      } else if (robotColors.modelPreset === "industrial") {
        // Industrial Bot
        const headGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const headMat = new THREE.MeshPhysicalMaterial({ 
          color: robotColors.headColor, 
          metalness: 0.8, 
          roughness: 0.5,
          flatShading: true
        });
        headMatRef.current = headMat;
        const head = new THREE.Mesh(headGeo, headMat);
        robot.add(head);
        headRef.current = head;

        // Bolts
        const boltGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8);
        const boltMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 1.0 });
        const positions = [
          [0.35, 0.35, 0.4], [-0.35, 0.35, 0.4],
          [0.35, -0.35, 0.4], [-0.35, -0.35, 0.4]
        ];
        positions.forEach(pos => {
          const bolt = new THREE.Mesh(boltGeo, boltMat);
          bolt.position.set(pos[0], pos[1], pos[2]);
          bolt.rotation.x = Math.PI / 2;
          head.add(bolt);
        });

        // Eyes (Square)
        const eyeGeo = new THREE.PlaneGeometry(0.15, 0.15);
        const eyeMat = new THREE.MeshStandardMaterial({ color: robotColors.eyeColor, emissive: robotColors.eyeColor, emissiveIntensity: 2 });
        eyeMatRef.current = eyeMat;
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        leftEye.position.set(-0.2, 0.1, 0.41);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
        rightEye.position.set(0.2, 0.1, 0.41);
        head.add(leftEye, rightEye);
        leftEyeRef.current = leftEye;
        rightEyeRef.current = rightEye;
      }

      // Body (Floating)
      const bodyGeo = new THREE.CylinderGeometry(0.35, 0.15, 0.8, 64);
      const bodyMat = new THREE.MeshPhysicalMaterial({ 
        color: robotColors.bodyColor, 
        metalness: 1.0, 
        roughness: 0.2,
        clearcoat: 0.5
      });
      bodyMatRef.current = bodyMat;
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = -0.6;
      robot.add(body);

      // Glow ring (Advanced Torus)
      const ringGeo = new THREE.TorusGeometry(0.45, 0.015, 32, 100);
      const ringMat = new THREE.MeshBasicMaterial({ color: robotColors.auraColor, transparent: true, opacity: 0.6 });
      ringMatRef.current = ringMat;
      ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.15;
      robot.add(ring);

      ring2 = ring.clone();
      ring2.scale.set(1.2, 1.2, 1.2);
      ring2.position.y = -0.25;
      robot.add(ring2);

      // Laser Beam (Hidden by default)
      const laserGeo = new THREE.CylinderGeometry(0.05, 0.05, 10, 32);
      const laserMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
      laser = new THREE.Mesh(laserGeo, laserMat);
      laser.rotation.x = Math.PI / 2;
      laser.position.z = 5;
      laser.visible = false;
      robot.add(laser);
      laserRef.current = laser;

      // Tractor Beam (Hidden by default)
      const tractorGeo = new THREE.CylinderGeometry(0.1, 0.4, 6, 32, 1, true);
      const tractorMat = new THREE.MeshBasicMaterial({ 
        color: 0x00ffff, 
        transparent: true, 
        opacity: 0.3, 
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending 
      });
      const tractorBeam = new THREE.Mesh(tractorGeo, tractorMat);
      tractorBeam.rotation.x = Math.PI / 2;
      tractorBeam.position.z = 3;
      tractorBeam.visible = false;
      robot.add(tractorBeam);
      tractorBeamRef.current = tractorBeam;
    }

    // Sentiment Aura (PointLight)
    const aura = new THREE.PointLight(robotColors.auraColor, 2, 5);
    aura.position.set(0, 0, 0);
    robot.add(aura);
    auraRef.current = aura;
    auraMatRef.current = aura;

    scene.add(robot);

    camera.position.z = 4;
    camera.position.y = 0;

    // Animation Loop
    let frame = 0;
    let blinkTimer = 0;
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      frame += 0.03;
      blinkTimer += 0.03;

      if (robotRef.current) {
        const floatY = Math.sin(frame) * 0.15;
        robotRef.current.position.x = basePos.current.x;
        robotRef.current.position.y = basePos.current.y + floatY;
        
        // Base rotation (removed constant spinning)
        robotRef.current.rotation.z = Math.sin(frame * 0.4) * 0.05;

        // Comedic Glitch Shaking
        if (isGlitchingRef.current || glitchIntensity > 0) {
          const intensity = isGlitchingRef.current ? 1 : glitchIntensity;
          robotRef.current.position.x += (Math.random() - 0.5) * 0.2 * intensity;
          robotRef.current.position.y += (Math.random() - 0.5) * 0.2 * intensity;
          robotRef.current.rotation.z += (Math.random() - 0.5) * 0.5 * intensity;
          
          if (headMatRef.current) {
            headMatRef.current.emissiveIntensity = 2 + Math.random() * 5 * intensity;
            if (Math.random() > 0.8) headMatRef.current.color.set(0xff0000);
            else headMatRef.current.color.set(robotColorsRef.current.headColor);
          }
        } else if (headMatRef.current) {
          headMatRef.current.emissiveIntensity = robotColorsRef.current.emissiveIntensity;
          headMatRef.current.color.set(robotColorsRef.current.headColor);
        }

        // Smooth head rotation interpolation
        if (headRef.current) {
          headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, targetHeadRot.current.x, 0.1);
          headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, targetHeadRot.current.y, 0.1);
          headRef.current.rotation.z = THREE.MathUtils.lerp(headRef.current.rotation.z, targetHeadRot.current.z, 0.1);
        }

        // Eye Animations
        if (leftEyeRef.current && rightEyeRef.current) {
          // Blinking
          if (blinkTimer > 4) {
            const blinkProgress = (blinkTimer - 4) * 10;
            if (blinkProgress < Math.PI) {
              const scale = 1 - Math.sin(blinkProgress);
              leftEyeRef.current.scale.y = scale;
              rightEyeRef.current.scale.y = scale;
            } else {
              leftEyeRef.current.scale.y = 1;
              rightEyeRef.current.scale.y = 1;
              blinkTimer = Math.random() * 2; // Randomize next blink
            }
          }

          // Pulsing Glow
          const glow = (robotColorsRef.current.emissiveIntensity || 1) * (0.8 + Math.sin(frame * 2) * 0.4);
          if ((leftEyeRef.current.material as any).emissiveIntensity !== undefined) {
            (leftEyeRef.current.material as any).emissiveIntensity = glow;
          }
          if ((rightEyeRef.current.material as any).emissiveIntensity !== undefined) {
            (rightEyeRef.current.material as any).emissiveIntensity = glow;
          }
        }
      }
      
      // Ring rotation
      if (ring) ring.rotation.z += 0.05;
      if (ring2) ring2.rotation.z -= 0.03;

      // Core animation
      if (core) {
        core.rotation.y += 0.02;
        core.rotation.x += 0.01;
        core.scale.setScalar(1 + Math.sin(frame * 4) * 0.1);
      }

      // Tractor beam pulse
      if (tractorBeamRef.current && tractorBeamRef.current.visible) {
        tractorBeamRef.current.scale.x = 1 + Math.sin(frame * 10) * 0.05;
        tractorBeamRef.current.scale.y = 1 + Math.sin(frame * 10) * 0.05;
        (tractorBeamRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(frame * 15) * 0.1;
      }

      // Laser flicker
      if (laser && laser.visible) {
        laser.scale.x = 0.8 + Math.random() * 0.4;
        laser.scale.z = 0.8 + Math.random() * 0.4;
      }

      // Tractor Beam Animation
      if (tractorBeamRef.current && tractorBeamRef.current.visible) {
        tractorBeamRef.current.rotation.z += 0.1;
        tractorBeamRef.current.scale.x = 1 + Math.sin(frame * 10) * 0.1;
        tractorBeamRef.current.scale.y = 1 + Math.sin(frame * 10) * 0.1;
        // Point towards center
        tractorBeamRef.current.lookAt(new THREE.Vector3(0, 0, 0));
      }

      // Aura Animation
      if (auraRef.current) {
        auraRef.current.intensity = (robotColorsRef.current.auraIntensity || 2) * (0.75 + Math.sin(frame * 2) * 0.25);
        
        const colors: Record<string, number> = {
          positive: 0x00ff88,
          neutral: 0x00ffff,
          negative: 0xffaa00,
          excited: 0xff00ff,
          toxic: 0xff0000
        };
        const targetColor = colors[sentiment] || 0x00ffff;
        auraRef.current.color.lerp(new THREE.Color(targetColor), 0.05);
      }

      renderer.render(scene, camera);
    };
    animate();
    setIsLoading(false);

    // Handle Resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    const currentMount = mountRef.current;
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationId);
      if (currentMount) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      laserRef.current = null;
      tractorBeamRef.current = null;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    };
  }, [robotColors.customModelUrl, robotColors.modelType, robotColors.modelPreset]);

  const LoadingScreen = () => (
    <motion.div 
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center gap-8"
    >
      <div className="relative">
        <div className="w-24 h-24 border-4 border-cyan-500/20 rounded-full animate-ping" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="text-cyan-400 animate-pulse" size={40} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-white font-bold tracking-[0.3em] uppercase text-sm">Initializing Kronos AI</h2>
        <p className="text-cyan-400/60 text-[10px] font-mono animate-pulse">Syncing with neural network...</p>
      </div>
    </motion.div>
  );

  return (
    <ErrorBoundary>
      <div 
        className="relative w-full h-screen overflow-hidden bg-transparent font-sans text-white cursor-move"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <AnimatePresence>
          {(isLoading || !isAuthReady) && <LoadingScreen />}
        </AnimatePresence>

        {/* Top Right Controls - Removed and moved to bottom left */}

        {/* Background Testing Overlay */}
        <AnimatePresence>
          {showStreamerRoom && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[-1] bg-cover bg-center"
              style={{ backgroundImage: `url('https://images.unsplash.com/photo-1614018424754-6656473994c5?q=80&w=2070&auto=format&fit=crop')` }}
            >
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* AR Mode Video Background */}
        <AnimatePresence>
          {showAR && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[-2] overflow-hidden"
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute min-w-full min-h-full object-cover"
                style={{ transform: 'scaleX(-1)' }} // Mirror the camera
              />
              <div className="absolute inset-0 bg-black/20" />
            </motion.div>
          )}
        </AnimatePresence>
      {/* Glitch Overlay */}
      <AnimatePresence>
        {glitchMessage && (
          <motion.div 
            initial={{ scale: 0, opacity: 0, rotate: -10 }}
            animate={{ scale: 1.5, opacity: 1, rotate: 0 }}
            exit={{ scale: 2, opacity: 0 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none"
          >
            <div className="bg-red-500/20 backdrop-blur-md border-2 border-red-500 px-8 py-4 rounded-2xl shadow-[0_0_30px_rgba(239,68,68,0.5)]">
              <span className="text-4xl font-mono font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                {glitchMessage}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dashboard Overlay */}
      <AnimatePresence>
        {showDashboard && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(20px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 sm:p-8 pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-4xl max-h-[90vh] bg-zinc-900/90 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Dashboard Header */}
              <div className="p-4 sm:p-8 border-b border-white/5 flex flex-col sm:flex-row items-center justify-between bg-white/5 gap-4">
                <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-cyan-500/20 rounded-2xl text-cyan-400">
                      <BarChart2 size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Bot Command Center</h2>
                      <p className="text-xs text-white/40 font-medium uppercase tracking-widest">Real-time Analytics & Control</p>
                    </div>
                  </div>
                  
                  {/* Tabs */}
                  <div className="flex bg-black/40 p-1 rounded-2xl border border-white/5">
                    <button 
                      onClick={() => setActiveTab("stats")}
                      className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === "stats" ? "bg-cyan-500 text-black shadow-lg" : "text-white/40 hover:text-white"}`}
                    >
                      Stats
                    </button>
                    <button 
                      onClick={() => setActiveTab("commands")}
                      className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === "commands" ? "bg-cyan-500 text-black shadow-lg" : "text-white/40 hover:text-white"}`}
                    >
                      Commands
                    </button>
                    <button 
                      onClick={() => setActiveTab("questions")}
                      className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === "questions" ? "bg-cyan-500 text-black shadow-lg" : "text-white/40 hover:text-white"}`}
                    >
                      Questions
                    </button>
                    <button 
                      onClick={() => setActiveTab("settings")}
                      className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${activeTab === "settings" ? "bg-cyan-500 text-black shadow-lg" : "text-white/40 hover:text-white"}`}
                    >
                      Settings
                    </button>
                  </div>
                </div>
                <button 
                  onClick={() => setShowDashboard(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Dashboard Content */}
              <div className="p-4 sm:p-8 flex-1 overflow-y-auto custom-scrollbar">
                {activeTab === "stats" ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Stat Cards */}
                    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 flex flex-col gap-4">
                      <div className="flex items-center justify-between text-white/40">
                        <span className="text-[10px] font-bold uppercase tracking-wider">Total Messages</span>
                        <MessageSquare size={16} />
                      </div>
                      <div className="text-4xl font-bold text-white">{stats.messageCount}</div>
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
                        <TrendingUp size={12} />
                        <span>Live Stream Active</span>
                      </div>
                    </div>

                    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 flex flex-col gap-4">
                      <div className="flex items-center justify-between text-white/40">
                        <span className="text-[10px] font-bold uppercase tracking-wider">Active Users</span>
                        <Activity size={16} />
                      </div>
                      <div className="text-4xl font-bold text-white">{stats.activeUsers}</div>
                      <div className="flex items-center gap-2 text-cyan-400 text-xs font-medium">
                        <User size={12} />
                        <span>Unique Participants</span>
                      </div>
                    </div>

                    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 flex flex-col gap-4">
                      <div className="flex items-center justify-between text-white/40">
                        <span className="text-[10px] font-bold uppercase tracking-wider">Sentiment Score</span>
                        <Sparkles size={16} />
                      </div>
                      <div className="text-4xl font-bold text-white">
                        {(stats.sentimentScore * 100).toFixed(0)}%
                      </div>
                      <div className={`flex items-center gap-2 text-xs font-medium ${stats.sentimentScore >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        <TrendingUp size={12} className={stats.sentimentScore < 0 ? 'rotate-180' : ''} />
                        <span>{stats.sentimentScore >= 0 ? 'Positive Vibes' : 'Negative Shift'}</span>
                      </div>
                    </div>

                    {/* Large Chart Placeholder / Info Section */}
                    <div className="md:col-span-3 p-8 bg-white/5 rounded-[2rem] border border-white/5">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest">Channel Activity</h3>
                        <div className="flex gap-2">
                          <div className="px-3 py-1 bg-cyan-500/10 text-cyan-400 rounded-full text-[10px] font-bold uppercase">Live</div>
                        </div>
                      </div>
                      
                      <div className="h-48 flex items-end gap-2 px-4">
                        {/* Simulated Bar Chart */}
                        {[40, 70, 45, 90, 65, 80, 55, 100, 85, 60, 75, 50].map((h, i) => (
                          <motion.div 
                            key={i}
                            initial={{ height: 0 }}
                            animate={{ height: `${h}%` }}
                            transition={{ delay: i * 0.05, duration: 0.5 }}
                            className="flex-1 bg-gradient-to-t from-cyan-500/20 to-cyan-400 rounded-t-lg"
                          />
                        ))}
                      </div>
                      <div className="flex justify-between mt-4 px-4 text-[10px] font-bold text-white/20 uppercase tracking-widest">
                        <span>1h ago</span>
                        <span>30m ago</span>
                        <span>Now</span>
                      </div>
                    </div>
                  </div>
                ) : activeTab === "commands" ? (
                  <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest">Custom Chat Commands</h3>
                      <button 
                        onClick={() => setShowCommandEditor(true)}
                        className="px-6 py-3 bg-cyan-500 text-black text-xs font-bold uppercase tracking-widest rounded-2xl hover:bg-cyan-400 transition-all shadow-lg"
                      >
                        Add New Command
                      </button>
                    </div>

                    {/* Command List */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {customCommands.map((cmd) => (
                        <div key={cmd.id} className="p-6 bg-white/5 rounded-3xl border border-white/5 flex flex-col gap-4 group hover:bg-white/10 transition-all">
                          <div className="flex items-center justify-between">
                            <span className="px-3 py-1 bg-cyan-500/20 text-cyan-400 rounded-lg text-xs font-bold font-mono">{cmd.trigger}</span>
                            <button 
                              onClick={() => handleDeleteCommand(cmd.id)}
                              className="p-2 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <X size={16} />
                            </button>
                          </div>
                          <p className="text-sm text-white/60 italic">"{cmd.response}"</p>
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/20">
                            <Sparkles size={12} />
                            <span>Reaction: {cmd.reaction}</span>
                          </div>
                        </div>
                      ))}
                      {customCommands.length === 0 && (
                        <div className="col-span-2 py-20 text-center border-2 border-dashed border-white/5 rounded-[2rem]">
                          <p className="text-white/20 font-bold uppercase tracking-widest">No custom commands yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : activeTab === "questions" ? (
                  <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest">Collected Questions</h3>
                        <p className="text-[10px] text-white/20 uppercase tracking-wider">Robot will periodically ask these to the streamer</p>
                      </div>
                      <div className="flex gap-3">
                        <button 
                          onClick={() => setStoredQuestions([])}
                          className="px-6 py-3 bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-widest rounded-2xl hover:bg-red-500/20 transition-all border border-red-500/20"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {storedQuestions.map((q, idx) => (
                        <div key={q.id || idx} className="p-6 bg-white/5 rounded-3xl border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-cyan-400 font-mono">{q.user}</span>
                              <span className="text-[10px] text-white/20">{new Date(q.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-sm text-white/80">"{q.question}"</p>
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={async () => {
                                // Manually trigger this question
                                try {
                                  const apiKey = process.env.GEMINI_API_KEY;
                                  if (apiKey) {
                                    const ai = new GoogleGenAI({ apiKey });
                                    const currentPersonality = PERSONALITIES[robotColors.personality] || PERSONALITIES.kronos;
                                    const response = await ai.models.generateContent({
                                      model: "gemini-3-flash-preview",
                                      contents: `Rephrase this question from ${q.user} to the streamer in a ${currentPersonality.name} way. Make it funny, interesting, and quirky. Don't just repeat it, make it an interaction. Question: ${q.question}`,
                                    });
                                    const funnyQuestion = response.text;
                                    if (funnyQuestion) {
                                      setSummary(funnyQuestion);
                                      speakGemini(funnyQuestion);
                                    }
                                  } else {
                                    const askText = `Hey streamer, ${q.user} wants to know: ${q.question}`;
                                    setSummary(askText);
                                    speakGemini(askText);
                                  }
                                } catch (e) {
                                  const askText = `Hey streamer, ${q.user} wants to know: ${q.question}`;
                                  setSummary(askText);
                                  speakGemini(askText);
                                }
                                setStoredQuestions(prev => prev.filter((_, i) => i !== idx));
                              }}
                              className="p-3 bg-cyan-500/20 text-cyan-400 rounded-xl hover:bg-cyan-500 hover:text-black transition-all"
                              title="Ask Now"
                            >
                              <Send size={16} />
                            </button>
                            <button 
                              onClick={() => setStoredQuestions(prev => prev.filter((_, i) => i !== idx))}
                              className="p-3 bg-red-500/10 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-all"
                              title="Dismiss"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {storedQuestions.length === 0 && (
                        <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-[2rem]">
                          <p className="text-white/20 font-bold uppercase tracking-widest">No questions collected yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto w-full flex flex-col gap-12 py-8">
                    {/* Personality Selector */}
                    <div className="flex flex-col gap-6 p-8 bg-white/5 rounded-[2rem] border border-white/5">
                      <div className="flex items-center gap-4 text-cyan-400">
                        <Sparkles size={24} />
                        <h3 className="text-lg font-bold uppercase tracking-widest">Bot Personality</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {Object.entries(PERSONALITIES).map(([id, p]) => (
                          <button
                            key={id}
                            onClick={() => setRobotColors(prev => ({ ...prev, personality: id as any }))}
                            className={`p-6 rounded-3xl border transition-all text-left flex flex-col gap-2 ${
                              robotColors.personality === id 
                                ? 'bg-cyan-500/20 border-cyan-500/50 text-white' 
                                : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold uppercase tracking-widest text-xs">{p.name}</span>
                              {robotColors.personality === id && <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.5)]" />}
                            </div>
                            <p className="text-[10px] leading-relaxed opacity-60">{p.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Environment Testing */}
                    <div className="flex flex-col gap-6 p-8 bg-white/5 rounded-[2rem] border border-white/5">
                      <div className="flex items-center gap-4 text-cyan-400">
                        <Monitor size={24} />
                        <h3 className="text-lg font-bold uppercase tracking-widest">Environment & Rendering</h3>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/5">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-white uppercase tracking-widest">Streamer Room Background</span>
                            <span className="text-[10px] text-white/40 uppercase tracking-wider">Test how the bot looks in a real stream environment</span>
                          </div>
                          <button
                            onClick={() => setShowStreamerRoom(!showStreamerRoom)}
                            className={`w-14 h-8 rounded-full transition-all relative ${showStreamerRoom ? 'bg-cyan-500' : 'bg-white/10'}`}
                          >
                            <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${showStreamerRoom ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/5">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-white uppercase tracking-widest">AR Mode (Webcam)</span>
                            <span className="text-[10px] text-white/40 uppercase tracking-wider">Use your webcam as the background for the robot</span>
                          </div>
                          <button
                            onClick={() => setShowAR(!showAR)}
                            className={`w-14 h-8 rounded-full transition-all relative ${showAR ? 'bg-cyan-500' : 'bg-white/10'}`}
                          >
                            <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${showAR ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/5">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-bold text-white uppercase tracking-widest">Streamer Mode (Hide UI)</span>
                            <span className="text-[10px] text-white/40 uppercase tracking-wider">Hide all UI elements for a clean stream overlay</span>
                          </div>
                          <button
                            onClick={() => setShowUI(!showUI)}
                            className={`w-14 h-8 rounded-full transition-all relative ${!showUI ? 'bg-cyan-500' : 'bg-white/10'}`}
                          >
                            <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${!showUI ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div className="flex flex-col gap-3">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Robot Transparency</label>
                            <input 
                              type="range" 
                              min="0" 
                              max="1" 
                              step="0.01"
                              value={robotColors.transmission}
                              onChange={(e) => setRobotColors(prev => ({ ...prev, transmission: parseFloat(e.target.value) }))}
                              className="w-full accent-cyan-500"
                            />
                            <div className="flex justify-between text-[10px] text-white/20 font-bold uppercase">
                              <span>Solid</span>
                              <span>Ghostly</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-3">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Render Exposure</label>
                            <input 
                              type="range" 
                              min="0.1" 
                              max="3" 
                              step="0.1"
                              value={robotColors.exposure}
                              onChange={(e) => setRobotColors(prev => ({ ...prev, exposure: parseFloat(e.target.value) }))}
                              className="w-full accent-cyan-500"
                            />
                            <div className="flex justify-between text-[10px] text-white/20 font-bold uppercase">
                              <span>Dim</span>
                              <span>Bright</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Test Chat Interaction */}
                    <div className="flex flex-col gap-6 p-8 bg-white/5 rounded-[2rem] border border-white/5">
                      <div className="flex items-center gap-4 text-cyan-400">
                        <MessageSquare size={24} />
                        <h3 className="text-lg font-bold uppercase tracking-widest">Test Chat Interaction</h3>
                      </div>
                      
                      <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-4">
                        <input 
                          type="text"
                          value={simulatedInput}
                          onChange={(e) => setSimulatedInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSimulateChat()}
                          placeholder="Type a message to test the bot..."
                          className="bg-transparent border-none focus:outline-none text-sm font-medium text-white w-full placeholder:text-white/20"
                        />
                        <button onClick={handleSimulateChat} className="p-3 bg-cyan-500 text-black rounded-xl hover:bg-cyan-400 transition-colors">
                          <Send size={16} />
                        </button>
                      </div>
                      <p className="text-[10px] text-white/40 uppercase tracking-wider">This simulates a message from a viewer to test reactions and AI summaries.</p>
                    </div>

                    <div className="flex flex-col gap-8 p-8 bg-white/5 rounded-[2rem] border border-white/5">
                      <div className="flex items-center gap-4 text-cyan-400">
                        <Activity size={24} />
                        <h3 className="text-lg font-bold uppercase tracking-widest">Twitch Integration</h3>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="flex flex-col gap-3">
                          <label className="text-xs font-bold uppercase tracking-widest text-white/40">Target Channel</label>
                          <div className="flex gap-3">
                            <input 
                              type="text" 
                              placeholder={currentChannel || "Channel Name"}
                              className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white font-mono focus:outline-none focus:border-cyan-500 transition-all"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") changeChannel((e.target as HTMLInputElement).value);
                              }}
                            />
                            <button 
                              onClick={(e) => {
                                const input = e.currentTarget.previousSibling as HTMLInputElement;
                                changeChannel(input.value);
                              }}
                              disabled={isChangingChannel}
                              className="px-8 py-4 bg-cyan-500 text-black font-bold uppercase tracking-widest rounded-2xl hover:bg-cyan-400 transition-all shadow-lg disabled:opacity-50"
                            >
                              {isChangingChannel ? "Linking..." : "Connect"}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 p-4 bg-black/40 rounded-2xl border border-white/5">
                          <input 
                            type="checkbox" 
                            id="default-channel"
                            checked={defaultChannel === currentChannel && !!currentChannel}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDefaultChannel(currentChannel);
                              } else {
                                setDefaultChannel(null);
                              }
                            }}
                            className="w-5 h-5 rounded border-white/10 bg-white/5 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-black"
                          />
                          <label htmlFor="default-channel" className="text-sm font-medium text-white/80 cursor-pointer">
                            Set <span className="text-cyan-400 font-mono">{currentChannel || "current channel"}</span> as default
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-8 p-8 bg-white/5 rounded-[2rem] border border-white/5">
                      <div className="flex items-center gap-4 text-cyan-400">
                        <MessageSquare size={24} />
                        <h3 className="text-lg font-bold uppercase tracking-widest">Voice Settings</h3>
                      </div>

                      <div className="space-y-8">
                        <div className="flex flex-col gap-4">
                          <div className="flex justify-between items-center">
                            <label className="text-xs font-bold uppercase tracking-widest text-white/40">Read-out Probability</label>
                            <span className="px-3 py-1 bg-cyan-500/10 text-cyan-400 rounded-full text-xs font-bold font-mono">
                              {Math.round(readOutChance * 100)}%
                            </span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            step="1"
                            value={readOutChance * 100}
                            onChange={(e) => setReadOutChance(parseInt(e.target.value) / 100)}
                            className="w-full h-2 bg-black/40 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                          />
                          <p className="text-[10px] text-white/20 uppercase tracking-wider leading-relaxed">
                            Determines how often the robot will read chat messages aloud. 
                            Higher values increase chatter frequency.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Command Editor Modal */}
              <AnimatePresence>
                {showCommandEditor && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-8"
                  >
                    <motion.div
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0.9, y: 20 }}
                      className="w-full max-w-md max-h-[90vh] bg-zinc-900 border border-white/10 rounded-[2rem] p-8 shadow-2xl overflow-y-auto custom-scrollbar"
                    >
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-bold text-white">Create Command</h3>
                        <button onClick={() => setShowCommandEditor(false)} className="text-white/40 hover:text-white">
                          <X size={24} />
                        </button>
                      </div>

                      <div className="space-y-6">
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Trigger (e.g. !hello)</label>
                          <input 
                            type="text" 
                            value={newCommand.trigger}
                            onChange={(e) => setNewCommand(prev => ({ ...prev, trigger: e.target.value }))}
                            placeholder="!command"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Response Message</label>
                          <textarea 
                            value={newCommand.response}
                            onChange={(e) => setNewCommand(prev => ({ ...prev, response: e.target.value }))}
                            placeholder="What should the bot say?"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors h-24 resize-none"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Robot Reaction</label>
                          <select 
                            value={newCommand.reaction}
                            onChange={(e) => setNewCommand(prev => ({ ...prev, reaction: e.target.value }))}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                          >
                            <option value="happy">Happy (Chirp)</option>
                            <option value="wave">Wave (Tilt)</option>
                            <option value="dance">Dance (Spin)</option>
                            <option value="thinking">Thinking (Glow)</option>
                            <option value="ban">Ban (Zap)</option>
                          </select>
                        </div>

                        <button 
                          onClick={handleAddCommand}
                          className="w-full py-4 bg-cyan-500 text-black font-bold uppercase tracking-widest rounded-2xl hover:bg-cyan-400 transition-all shadow-lg mt-4"
                        >
                          Save Command
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Dashboard Footer */}
              <div className="mt-auto p-4 sm:p-8 bg-white/5 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {user ? (
                    <>
                      <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-10 h-10 rounded-full border border-white/20" />
                      <div>
                        <p className="text-sm font-bold text-white">{user.displayName}</p>
                        <p className="text-[10px] text-white/40 uppercase tracking-wider">Bot Administrator</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-white/40 italic">Sign in to manage your bot</p>
                  )}
                </div>
                {user && (
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-6 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold uppercase tracking-widest transition-all"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={mountRef} className="absolute inset-0 z-0 pointer-events-none" />

      {/* Floating Reaction Icon */}
      <AnimatePresence>
        {reaction && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 20 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              x: (robotRef.current?.position.x || 0) * 100,
              y: -(robotRef.current?.position.y || 0) * 100 - 100
            }}
            exit={{ opacity: 0, scale: 0.5, y: -20 }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none"
          >
            <div className="bg-cyan-500/80 backdrop-blur-md p-3 rounded-full shadow-[0_0_20px_rgba(6,182,212,0.5)] border border-white/20">
              {reaction.type === "wave" && <User size={24} className="text-white animate-bounce" />}
              {reaction.type === "thinking" && <Sparkles size={24} className="text-white animate-spin" />}
              {reaction.type === "mention" && <MessageSquare size={24} className="text-white" />}
              {reaction.type === "ban" && <ShieldAlert size={24} className="text-white animate-pulse" />}
              {reaction.type === "dance" && <Sparkles size={24} className="text-white animate-ping" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay UI */}
      {showUI && (
        <div className="absolute inset-0 flex flex-col justify-between p-4 sm:p-8 pointer-events-none">
        {/* Top Section: Summary */}
        <div className="flex justify-end">
          <AnimatePresence>
            {summary && isTalking && (
              <motion.div
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 50, scale: 0.9 }}
                className="w-full max-w-md p-6 bg-black/70 backdrop-blur-xl border border-cyan-500/40 rounded-3xl shadow-[0_0_30px_rgba(6,182,212,0.2)] pointer-events-auto mr-4 sm:mr-12"
              >
                <div className="flex items-center gap-3 mb-3 text-cyan-400">
                  <Sparkles size={18} className="animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
                    {PERSONALITIES[robotColors.personality]?.name || "Kronos AI"} Insight
                  </span>
                </div>
                <p className="text-lg leading-relaxed font-medium italic text-cyan-50">"{summary}"</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Section: Chat Feed & Controls */}
        <div className="flex justify-start items-end w-full">
          {/* Customizer Toggle & Panel */}
            <AnimatePresence>
              {showCustomizer && (
                <motion.div
                  initial={{ opacity: 0, x: -50, scale: 0.9 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -50, scale: 0.9 }}
                  className="w-64 max-h-[70vh] p-6 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl flex flex-col gap-4 overflow-y-auto custom-scrollbar"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-white/60">Robot Customizer</h3>
                    <button onClick={() => setShowCustomizer(false)} className="text-white/40 hover:text-white transition-colors">
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-4">
                    {!user && (
                      <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl text-center">
                        <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-3">Sign in to save settings</p>
                        <button 
                          onClick={handleLogin}
                          className="w-full py-2 bg-cyan-500 text-black text-[10px] font-bold uppercase tracking-widest rounded-xl hover:bg-cyan-400 transition-colors flex items-center justify-center gap-2"
                        >
                          <LogIn size={12} />
                          Login
                        </button>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Robot Model</label>
                      <select 
                        value={robotColors.modelPreset} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, modelPreset: e.target.value as any }))}
                        disabled={!!robotColors.customModelUrl}
                        className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold text-white uppercase tracking-widest focus:outline-none focus:border-cyan-500/50 transition-all ${robotColors.customModelUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {Object.entries(MODEL_PRESETS).map(([id, name]) => (
                          <option key={id} value={id}>{name}</option>
                        ))}
                      </select>
                      {robotColors.customModelUrl && (
                        <span className="text-[9px] text-yellow-400 mt-1 font-bold">Custom model active. Reset below to use presets.</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Head Color</label>
                      <input 
                        type="color" 
                        value={robotColors.headColor} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, headColor: e.target.value }))}
                        className="w-full h-8 rounded bg-transparent border-none cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Emissive Color</label>
                      <input 
                        type="color" 
                        value={robotColors.emissiveColor} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, emissiveColor: e.target.value }))}
                        className="w-full h-8 rounded bg-transparent border-none cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Emissive Intensity</label>
                      <input 
                        type="range" 
                        min="0" max="5" step="0.1"
                        value={robotColors.emissiveIntensity} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, emissiveIntensity: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-500"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Transparency</label>
                      <input 
                        type="range" 
                        min="0" max="1" step="0.01"
                        value={robotColors.transmission} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, transmission: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-500"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Exposure</label>
                      <input 
                        type="range" 
                        min="0.1" max="3" step="0.1"
                        value={robotColors.exposure} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, exposure: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-500"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Body Color</label>
                      <input 
                        type="color" 
                        value={robotColors.bodyColor} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, bodyColor: e.target.value }))}
                        className="w-full h-8 rounded bg-transparent border-none cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Eye Color</label>
                      <input 
                        type="color" 
                        value={robotColors.eyeColor} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, eyeColor: e.target.value }))}
                        className="w-full h-8 rounded bg-transparent border-none cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Aura Intensity</label>
                      <input 
                        type="range" 
                        min="0" max="50" step="1"
                        value={robotColors.auraIntensity} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, auraIntensity: parseFloat(e.target.value) }))}
                        className="w-full accent-cyan-500"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-white/40">Aura Color</label>
                      <input 
                        type="color" 
                        value={robotColors.auraColor} 
                        onChange={(e) => setRobotColors(prev => ({ ...prev, auraColor: e.target.value }))}
                        className="w-full h-8 rounded bg-transparent border-none cursor-pointer"
                      />
                    </div>

                    <div className="flex flex-col gap-2 pt-4 border-t border-white/5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Custom 3D Model (GLB/FBX)</label>
                      <div className="flex flex-col gap-3">
                        <input 
                          type="file" 
                          accept=".glb,.gltf,.fbx"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const url = URL.createObjectURL(file);
                              const type = file.name.toLowerCase().endsWith(".fbx") ? "fbx" : "glb";
                              setRobotColors(prev => {
                                if (prev.customModelUrl) URL.revokeObjectURL(prev.customModelUrl);
                                return { ...prev, customModelUrl: url, modelType: type };
                              });
                            }
                          }}
                          className="hidden"
                          id="model-upload"
                        />
                        <label 
                          htmlFor="model-upload"
                          className="w-full py-3 bg-white/5 border border-dashed border-white/20 rounded-xl text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white hover:border-cyan-500/50 transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Plus size={14} />
                          {robotColors.customModelUrl ? "Change Model" : "Upload Model"}
                        </label>
                        {robotColors.customModelUrl && (
                          <button 
                            onClick={() => setRobotColors(prev => {
                              if (prev.customModelUrl) URL.revokeObjectURL(prev.customModelUrl);
                              return { ...prev, customModelUrl: null, modelType: null };
                            })}
                            className="text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors flex items-center justify-center gap-2"
                          >
                            <Trash2 size={12} />
                            Reset to Default
                          </button>
                        )}
                      </div>
                    </div>

                    <button 
                      onClick={() => {
                        // Settings are already debounced, but this gives visual feedback
                        playSound("chirp");
                        setShowCustomizer(false);
                      }}
                      className="w-full py-4 mt-4 bg-cyan-500 text-black font-black uppercase tracking-[0.2em] text-[10px] rounded-xl hover:bg-cyan-400 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                    >
                      Apply & Save
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-3">
              {/* Controls moved to bottom left */}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Left Controls */}
      <div className="absolute bottom-8 left-8 flex items-center gap-3 z-[100] pointer-events-auto">
        {!showDashboard && !showCustomizer && (
          <button 
            onClick={() => setShowUI(!showUI)} 
            className="p-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl text-white/60 hover:text-white hover:border-white/20 transition-all shadow-lg"
            title={showUI ? "Hide UI" : "Show UI"}
          >
            {showUI ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        )}
        
        {showUI && !showDashboard && !showCustomizer && (
          <>
            <button 
              onClick={() => setShowDashboard(!showDashboard)} 
              className={`p-3 backdrop-blur-xl border rounded-2xl transition-all shadow-lg ${showDashboard ? 'bg-cyan-500 text-black border-cyan-400' : 'bg-black/40 text-white/60 border-white/10 hover:text-white hover:border-white/20'}`}
              title="Dashboard"
            >
              <BarChart2 size={20} />
            </button>
            <button 
              onClick={() => setShowCustomizer(!showCustomizer)} 
              className={`p-3 backdrop-blur-xl border rounded-2xl transition-all shadow-lg ${showCustomizer ? 'bg-cyan-500 text-black border-cyan-400' : 'bg-black/40 text-white/60 border-white/10 hover:text-white hover:border-white/20'}`}
              title="Robot Customizer"
            >
              <Zap size={20} />
            </button>
          </>
        )}
      </div>

      {/* Branding / Status */}
      {showUI && (
        <div className="absolute top-6 left-6 flex flex-col gap-4 pointer-events-auto">
          <div className="flex items-center gap-3 opacity-40 hover:opacity-100 transition-opacity duration-500">
            <div className="relative">
              <div className={`w-2.5 h-2.5 rounded-full ${twitchStatus === "connected" ? "bg-cyan-500 animate-ping" : twitchStatus === "failed" ? "bg-red-500" : "bg-yellow-500 animate-pulse"} absolute inset-0`} />
              <div className={`w-2.5 h-2.5 rounded-full ${twitchStatus === "connected" ? "bg-cyan-500" : twitchStatus === "failed" ? "bg-red-500" : "bg-yellow-500"} relative`} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">Kronos Protocol</span>
              <span className="text-[8px] font-mono uppercase tracking-widest text-white/50">
                {twitchStatus === "connected" ? "System Online" : twitchStatus === "failed" ? "Link Severed" : "Linking..."}
              </span>
            </div>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
