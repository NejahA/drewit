import { Tldraw, useEditor, AssetRecordType } from 'tldraw'
import { useEffect, useRef } from 'react'
import 'tldraw/tldraw.css'
import { usePusherPersistence } from './hooks/usePusherPersistence'
import { uploadAsset } from './utils/assetManager'

// ────────────────────────────────────────────────
// Throttle utility
function throttle(fn: (...args: any[]) => void, delay: number) {
	let lastCall = 0
	return function (this: any, ...args: any[]) {
		const now = Date.now()
		if (now - lastCall >= delay) {
			lastCall = now
			fn.apply(this, args)
		}
	}
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
			const pageName = page?.name?.trim() || 'Untitled'
			document.title = `dessimbol - ${pageName}`
		}
		// Immediate update
		updateTitle()
		// Listen to page switches / renames via store (narrow filter)
		const unsubscribeStore = editor.store.listen(
			(update) => {
				const { changes } = update
				if (
					Object.entries(changes.updated || {}).some(([id, change]) =>
						id.startsWith('page:') && 'name' in (change?.[1] ?? {})
					)
				) {
					updateTitle()
				}
			},
			{ source: 'all', scope: 'document' }
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
				const { blob } = await editor.toImage([] as const, {
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
		const throttledUpdate = throttle(updateFavicon, 250)

		const unsubscribe = editor.store.listen(
			() => throttledUpdate(),
			{ source: 'user', scope: 'session' }
		)
		// Initial call
		updateFavicon()
		return () => unsubscribe()
	}, [editor])
	return null
}
// ────────────────────────────────────────────────
export default function App() {
	const { store, loadingState } = usePusherPersistence()

	if (loadingState.status === 'loading') {
		return (
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#666' }}>
				Loading shared canvas...
			</div>
		)
	}

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: '#f8f9fa',
			}}
		>
			<Tldraw
				store={store}
				autoFocus
				onMount={(editor) => {
					// Register custom asset handler for URLs
					editor.registerExternalAssetHandler('url', async ({ url }) => {
						return {
							id: AssetRecordType.createId(),
							typeName: 'asset',
							type: 'image',
							props: {
								src: url,
								name: 'image',
								width: 100,
								height: 100,
								isAnimated: false,
								mimeType: 'image/png',
							},
							meta: {},
						} as any
					})

					// Register custom asset handler for files (uploads to Supabase)
					editor.registerExternalAssetHandler('file', async ({ file }) => {
						const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`
						const url = await uploadAsset(file, fileName)

						return {
							id: AssetRecordType.createId(),
							typeName: 'asset',
							type: 'image',
							props: {
								src: url,
								name: file.name,
								width: 100,
								height: 100,
								isAnimated: false,
								mimeType: file.type,
							},
							meta: {},
						} as any
					})
				}}
			>
				<DynamicTitleUpdater />
				<DynamicFaviconUpdater />
			</Tldraw>
		</div>
	)
}