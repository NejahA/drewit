import { Tldraw, useEditor, track } from 'tldraw'
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
// Reliable title updater – uses page events + minimal store filtering
function DynamicTitleUpdater() {
	const editor = useEditor()

	useEffect(() => {
		if (!editor) return

		const updateTitle = () => {
			const pageId = editor.getCurrentPageId()
			const page = editor.getPage(pageId)
			const pageName = page?.name?.trim() || `Untitled`
			document.title = `drewit - ${pageName}`
		}

		// Immediate update
		updateTitle()

		// Listen to page switches / renames via store (narrow filter)
		const unsubscribeStore = editor.store.listen(
			(update) => {
				const { changes } = update
				if (
					changes.state?.page?.pageId ||                    // page switch
					Object.keys(changes.updated || {}).some((id) => id.startsWith('page:') && 'name' in changes.updated[id][1])
				) {
					updateTitle()
				}
			},
			{ source: 'all', scope: 'document' } // limit scope
		)

		// Safety interval (low frequency)
		const interval = setInterval(updateTitle, 3000)

		return () => {
			unsubscribeStore()
			clearInterval(interval)
		}
	}, [editor])

	return null
}

// ────────────────────────────────────────────────
// Favicon updater – isolated listener, longer throttle
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
				const viewportBounds = editor.getViewportPageBounds()

				const { blob } = await editor.toImage([], {
					bounds: viewportBounds,
					format: 'png',
					scale: 0.75,
					background: false,
					quality: 0.6,
				})

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

				const newDataUrl = canvas.toDataURL('image/png', 0.7)

				if (newDataUrl !== lastDataUrlRef.current) {
					lastDataUrlRef.current = newDataUrl

					const oldLink = document.getElementById('dynamic-favicon') as HTMLLinkElement | null
					if (oldLink?.parentNode) {
						const newLink = document.createElement('link')
						newLink.id = 'dynamic-favicon'
						newLink.rel = 'icon'
						newLink.type = 'image/png'
						newLink.href = newDataUrl
						oldLink.parentNode.replaceChild(newLink, oldLink)
					}
				}

				URL.revokeObjectURL(url)
			} catch (err) {
				console.warn('Favicon update skipped:', err)
			} finally {
				isUpdatingRef.current = false
			}
		}

		const throttledUpdate = throttle(updateFavicon, 250) // increased to reduce load

		const unsubscribe = editor.store.listen(
			() => throttledUpdate(),
			{ source: 'user', scope: 'session' } // narrower scope
		)

		// Initial call
		updateFavicon()

		return () => unsubscribe()
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
			<Tldraw
				persistenceKey="drewit-main-canvas"
			>
				<DynamicTitleUpdater />
				<DynamicFaviconUpdater />
			</Tldraw>
		</div>
	)
}