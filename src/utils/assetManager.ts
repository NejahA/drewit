import { supabase } from '../supabase'

/**
 * Uploads a file to Supabase Storage and returns the public URL.
 * Uses the 'drawing-assets' bucket.
 */
export async function uploadAsset(file: File | Blob, fileName: string): Promise<string> {
  const bucketName = 'drawing-assets'
  
  // 1. Upload the file
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: true
    })

  if (error) {
    if (error.message.includes('bucket not found')) {
      throw new Error('Supabase Storage bucket "drawing-assets" not found. Please create it in your Supabase Dashboard and set it to Public.')
    }
    throw error
  }

  // 2. Get the public URL
  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(data.path)

  return publicUrl
}
