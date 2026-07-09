import { useRef, useState, useEffect, useCallback } from "react";
import { UseMutationResult } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatRecordingTime } from "./helpers";

export function useAudioRecorder(
  selectedId: number | null,
  sendMutation: UseMutationResult<any, any, any, any>,
  agenteName?: string
) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Bruno 2026-05-19: Meta Cloud API NÃO aceita audio/webm — só ogg/opus,
      // mp4/m4a, aac, mp3. Gravar em webm fazia o áudio NÃO chegar no
      // WhatsApp do cliente (entrega falha silenciosa). Tenta ogg/opus
      // primeiro (Chromium suporta encoding em alguns ambientes; Firefox
      // suporta nativo), depois mp4 (Safari/iOS), aac, e só cai em webm
      // como último recurso pra não impedir gravação.
      const preferredTypes = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
        "audio/aac",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      const pickedMime = preferredTypes.find((t) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
      );
      const opts: MediaRecorderOptions = pickedMime ? { mimeType: pickedMime } : {};
      const mediaRecorder = new MediaRecorder(stream, opts);
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch {
      toast({ title: "Microfone nao disponivel", description: "Permita o acesso ao microfone no navegador.", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback((send: boolean) => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (!recorder) { setIsRecording(false); return; }

    if (send) {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      const originalStop = recorder.onstop;
      recorder.onstop = () => {
        if (originalStop) (originalStop as any)();
        // Usa o mime real escolhido pelo recorder (pode ser ogg/opus, mp4,
        // aac ou webm como fallback). Sem isso o filename ia sempre como
        // .webm e a Meta rejeitava o áudio (formato não suportado).
        const realMime = recorder.mimeType || "audio/ogg";
        const ext = realMime.includes("ogg") ? "ogg"
          : realMime.includes("mp4") ? "m4a"
          : realMime.includes("aac") ? "aac"
          : realMime.includes("mpeg") ? "mp3"
          : "webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: realMime });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result as string;
          if (selectedId) {
            sendMutation.mutate({
              texto: `[Audio ${formatRecordingTime(recordingTime)}]`,
              direction: "out",
              agente: agenteName || undefined,
              tipo: "audio",
              arquivo: base64,
              nomeArquivo: `audio_${Date.now()}.${ext}`,
            });
          }
        };
        reader.readAsDataURL(audioBlob);
        setIsRecording(false);
        setRecordingTime(0);
      };
    } else {
      recorder.onstop = () => {
        recorder.stream?.getTracks().forEach((t: any) => t.stop());
        setIsRecording(false);
        setRecordingTime(0);
      };
    }
    recorder.stop();
    mediaRecorderRef.current = null;
  }, [selectedId, sendMutation, recordingTime, agenteName]);

  return { isRecording, recordingTime, startRecording, stopRecording };
}

export function useFileHandler(
  selectedId: number | null,
  sendMutation: UseMutationResult<any, any, any, any>,
  agenteName?: string
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "Arquivo muito grande", description: "Limite de 10MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const isImage = file.type.startsWith("image/");
      const isAudio = file.type.startsWith("audio/");
      // Bruno 2026-06-05: PDF/doc/xls/etc precisam virar "document" — o
      // channel-router NÃO roteia tipo "file" (PDF não enviava). "document" é
      // tratado por Evolution (sendDocumentMessage) e Meta.
      const tipo = isImage ? "image" : isAudio ? "audio" : "document";
      const texto = isImage ? `[Imagem: ${file.name}]` : isAudio ? `[Audio: ${file.name}]` : `[Arquivo: ${file.name}]`;
      sendMutation.mutate({
        texto,
        direction: "out",
        agente: agenteName || undefined,
        tipo,
        arquivo: base64,
        nomeArquivo: file.name,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [selectedId, sendMutation, toast, agenteName]);

  return { fileInputRef, handleFileSelect };
}
