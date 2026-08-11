function getStorage() {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
}

export function readDraft(key) {
  const storage = getStorage()
  if (!storage) return null

  let raw
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      // storage unavailable — nothing more we can do
    }
    return null
  }
}

export function writeDraft(key, values) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(values))
  } catch {
    // quota exceeded / storage disabled — degrade silently, no persistence this session
  }
}

export function clearDraft(key) {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // nothing to do if storage is unavailable
  }
}

export function debounce(fn, delayMs) {
  let timer

  function debounced(...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delayMs)
  }

  debounced.cancel = () => clearTimeout(timer)

  return debounced
}
