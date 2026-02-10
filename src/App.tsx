import { Tldraw, useEditor } from 'tldraw'
import { useEffect, useRef } from 'react'
import 'tldraw/tldraw.css'

// ────────────────────────────────────────────────
// Throttle utility
function throttle<T extends () => void>(fn: T, delay: number): T {
	let lastCall = 0
	return function (this: any, ...args: any[]) {
		const now = Date.now()
		if (now - lastCall >= delay) {
			lastCall = now
			fn.apply(this, args)
		}
	} as T
}

// ────────────────────────────────────────────────
// Reliable title updater
function DynamicTitleUpdater() {
	const editor = useEditor()

	useEffect(() => {
		if (!editor) return

		const updateTitle = () => {
			const pageId = editor.getCurrentPageId()
			const page = editor.getPage(pageId)
			const pageName = page?.name?.trim() || 'Untitled'
			document.title = `drewit - ${pageName}`
		}

		updateTitle()

		const unsubscribe = editor.store.listen(
			(update) => {
				const { changes } = update
				if (
					changes.state?.page?.pageId ||
					Object.keys(changes.updated || {}).some((id) =>
						id.startsWith('page:') && 'name' in (changes.updated[id]?.[1] ?? {})
					)
				) {
					updateTitle()
				}
			},
			{ source: 'all', scope: 'document' }
		)

		const interval = setInterval(updateTitle, 3000)

		return () => {
			unsubscribe()
			clearInterval(interval)
		}
	}, [editor])

	return null
}

// ────────────────────────────────────────────────
// Robust favicon updater – skips on empty/invalid content
function DynamicFaviconUpdater() {
	const editor = useEditor()
	const isUpdatingRef = useRef(false)
	const lastDataUrlRef = useRef<string | null>(null)

	useEffect(() => {
		if (!editor) return

		const updateFavicon = async () => {
			if (isUpdatingRef.current) return
			isUpdatingRef.current = true

			try {
				const bounds = editor.getViewportPageBounds()
				if (!bounds || bounds.w <= 1 || bounds.h <= 1) {
					return // Invalid or zero-area bounds
				}

				// Skip if no visible shapes in current viewport
				const visibleShapes = editor.getShapesInBounds(bounds, { onlyVisible: true })
				if (visibleShapes.length === 0) {
					return
				}

				const { blob } = await editor.toImage([] as const, {
					bounds,
					format: 'png',
					scale: 0.5,          // Reduced for performance
					background: false,
					quality: 0.7,
				})

				if (!blob) return // Export failed silently

				const url = URL.createObjectURL(blob)
				const img = new Image()
				img.crossOrigin = 'anonymous'
				img.src = url

				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve()
					img.onerror = () => reject(new Error('Image load failed'))
				})

				const canvas = document.createElement('canvas')
				canvas.width = 32
				canvas.height = 32
				const ctx = canvas.getContext('2d')
				if (!ctx) return

				const side = Math.min(img.width, img.height)
				const sx = (img.width - side) / 2
				const sy = (img.height - side) / 2

				ctx.drawImage(img, sx, sy, side, side, 0, 0, 32, 32)

				const newDataUrl = canvas.toDataURL('image/png', 0.8)

				if (newDataUrl !== lastDataUrlRef.current) {
					lastDataUrlRef.current = newDataUrl

					let link = document.getElementById('dynamic-favicon') as HTMLLinkElement | null
					if (!link) {
						link = document.createElement('link')
						link.id = 'dynamic-favicon'
						link.rel = 'icon'
						link.type = 'image/png'
						document.head.appendChild(link)
					}
					link.href = newDataUrl
				}

				URL.revokeObjectURL(url)
			} catch (err) {
				console.warn('Favicon update failed:', err)
			} finally {
				isUpdatingRef.current = false
			}
		}

		const throttledUpdate = throttle(updateFavicon, 800) // Less frequent to reduce load

		const unsubscribe = editor.store.listen(
			(update) => {
				if (update.source === 'user') {
					throttledUpdate()
				}
			},
			{ source: 'all', scope: 'session' }
		)

		// Initial attempt after short delay (canvas needs time to initialize)
		const initialTimer = setTimeout(updateFavicon, 2000)

		return () => {
			unsubscribe()
			clearTimeout(initialTimer)
		}
	}, [editor])

	return null
}

// ────────────────────────────────────────────────
export default function App() {
	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: '#f8f9fa',
			}}
		>
			<Tldraw persistenceKey="drewit-main-canvas">
				<DynamicTitleUpdater />
				<DynamicFaviconUpdater />
			</Tldraw>
		</div>
	)
}