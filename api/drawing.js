import { connectToDatabase, Drawing } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    await connectToDatabase();

    const { method } = req;
    const { id: queryId } = req.query;
    const { id: bodyId, snapshot } = req.body || {};

    const id = queryId || bodyId || 'global-canvas';

    switch (method) {
      case 'GET':
        try {
          const drawing = await Drawing.findOne({ id });
          if (!drawing) {
            return res.status(200).json(null);
          }
          res.status(200).json(drawing.snapshot);
        } catch (err) {
          res.status(500).json({ error: `GET Error: ${err.message}` });
        }
        break;

      case 'POST':
        try {
          console.log(`[POST] Saving snapshot for id: ${id}, snapshot size: ${snapshot ? JSON.stringify(snapshot).length : 0} bytes`);
          if (!snapshot) {
            return res.status(400).json({ error: 'Snapshot is required' });
          }
          const updatedDrawing = await Drawing.findOneAndUpdate(
            { id },
            { snapshot },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          console.log(`[POST] Successfully saved drawing for id: ${id}`);
          res.status(200).json(updatedDrawing);
        } catch (err) {
          console.error(`[POST] Error saving drawing for id ${id}:`, err);
          res.status(500).json({ error: `POST Error: ${err.message}` });
        }
        break;

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (err) {
    console.error('Unhandled Serverless Error:', err);
    res.status(500).json({ 
      error: 'Unhandled Internal Server Error', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
