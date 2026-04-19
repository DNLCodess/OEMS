'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Camera, CameraOff, ShieldCheck } from 'lucide-react'

// Minimum and maximum interval between snapshots (milliseconds)
const MIN_INTERVAL = 2 * 60 * 1000   // 2 minutes
const MAX_INTERVAL = 8 * 60 * 1000   // 8 minutes

export function ProctoringCamera({ attemptId, studentId }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const streamRef   = useRef(null)
  const timerRef    = useRef(null)

  const [status, setStatus] = useState('requesting') // requesting | active | denied
  const [snapCount, setSnapCount] = useState(0)

  useEffect(() => {
    startCamera()
    return () => {
      stopCamera()
      clearTimeout(timerRef.current)
    }
  }, [])

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setStatus('active')
      scheduleNextSnapshot()
    } catch {
      setStatus('denied')
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function scheduleNextSnapshot() {
    const delay = MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL)
    timerRef.current = setTimeout(async () => {
      await takeSnapshot()
      scheduleNextSnapshot()
    }, delay)
  }

  async function takeSnapshot() {
    if (!videoRef.current || !canvasRef.current) return
    const video  = videoRef.current
    const canvas = canvasRef.current
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d').drawImage(video, 0, 0)

    canvas.toBlob(async blob => {
      if (!blob) return
      try {
        const supabase = createClient()
        const filename = `${studentId}/${attemptId}/${Date.now()}.jpg`
        const { data, error } = await supabase.storage
          .from('proctoring')
          .upload(filename, blob, { contentType: 'image/jpeg', upsert: false })

        if (error) {
          console.warn('[proctoring] upload failed:', error.message)
          return
        }

        const { data: { publicUrl } } = supabase.storage
          .from('proctoring')
          .getPublicUrl(filename)

        // Store reference in DB
        await supabase.from('proctoring_snapshots').insert({
          attempt_id: attemptId,
          student_id: studentId,
          image_url:  data?.path ?? filename,
          taken_at:   new Date().toISOString(),
        })

        setSnapCount(n => n + 1)
      } catch (err) {
        console.warn('[proctoring] snapshot error:', err)
      }
    }, 'image/jpeg', 0.7)
  }

  return (
    <div className="fixed bottom-20 right-4 z-30">
      {status === 'active' && (
        <div className="relative">
          {/* Live video preview — small */}
          <div className="w-28 h-20 rounded-xl overflow-hidden border-2 border-success shadow-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover scale-x-[-1]"
            />
          </div>
          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />
          {/* Status badge */}
          <div className="absolute -top-2 -right-2 flex items-center gap-1 bg-success text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full shadow">
            <ShieldCheck size={9} />
            Monitoring
          </div>
          {snapCount > 0 && (
            <p className="text-center text-[10px] text-text-muted mt-1">{snapCount} photo{snapCount !== 1 ? 's' : ''} taken</p>
          )}
        </div>
      )}

      {status === 'requesting' && (
        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700 shadow">
          <Camera size={12} className="animate-pulse" />
          Camera access…
        </div>
      )}

      {status === 'denied' && (
        <div className="flex items-center gap-1.5 bg-danger-light border border-danger/20 rounded-xl px-3 py-2 text-xs text-danger shadow">
          <CameraOff size={12} />
          Camera denied
        </div>
      )}
    </div>
  )
}
