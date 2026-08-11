'use client'

import { useEffect, useRef, useState } from 'react'
import { readDraft, writeDraft, clearDraft as clearDraftStorage, debounce } from './formDraftStorage'

const SAVE_DEBOUNCE_MS = 500

export function useFormDraft(key, { watch, reset, getValues }, { enabled = true } = {}) {
  const [restored, setRestored] = useState(false)
  const debouncedWriteRef = useRef(null)

  // Restore once on mount (or when the key identifies a different entity/form instance)
  useEffect(() => {
    if (!enabled) return
    const draft = readDraft(key)
    if (draft) {
      reset({ ...getValues(), ...draft })
      setRestored(true)
    }
    // Intentionally runs only when `key`/`enabled` change, not on every render —
    // this is a one-shot restore, not a continuous sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  // Debounced save on every field change
  useEffect(() => {
    if (!enabled) return

    debouncedWriteRef.current = debounce((values) => writeDraft(key, values), SAVE_DEBOUNCE_MS)
    const subscription = watch((values) => {
      debouncedWriteRef.current(values)
    })

    return () => {
      subscription.unsubscribe()
      debouncedWriteRef.current?.cancel?.()
    }
  }, [key, enabled, watch])

  function clearDraft() {
    clearDraftStorage(key)
  }

  function dismissRestored() {
    setRestored(false)
  }

  return { restored, clearDraft, dismissRestored }
}
