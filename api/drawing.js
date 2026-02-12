const { connectToDatabase, Drawing } = require('./_lib/db');

module.exports = async (req, res) => {
  await connectToDatabase();

  const { method } = req;
  const { id: queryId } = req.query; // For GET requests e.g. /api/drawing?id=global-canvas
  const { id: bodyId, snapshot } = req.body; // For POST requests

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
        res.status(500).json({ error: err.message });
      }
      break;

    case 'POST':
      try {
        if (!snapshot) {
          return res.status(400).json({ error: 'Snapshot is required' });
        }
        const updatedDrawing = await Drawing.findOneAndUpdate(
          { id },
          { snapshot },
          { upsert: true, new: true }
        );
        res.status(200).json(updatedDrawing);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
};
