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
          if (!snapshot) {
            console.warn(`[POST] Save rejected: Snapshot missing for id ${id}`);
            return res.status(400).json({ error: 'Snapshot is required' });
          }

          const snapshotSize = JSON.stringify(snapshot).length;
          console.log(`[POST] Saving for id: ${id} (${snapshotSize} bytes)`);

          const updatedDrawing = await Drawing.findOneAndUpdate(
            { id },
            { snapshot },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          if (updatedDrawing) {
            console.log(`[POST] Save successful for id: ${id}`);
            res.status(200).json({ success: true, timestamp: updatedDrawing.updatedAt });
          } else {
            console.error(`[POST] Save failed: No document returned for id ${id}`);
            res.status(500).json({ error: 'Save failed: Document not returned' });
          }
        } catch (err) {
          console.error(`[POST] Database Error for id ${id}:`, err);
          res.status(500).json({ error: `Database Error: ${err.message}` });
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
