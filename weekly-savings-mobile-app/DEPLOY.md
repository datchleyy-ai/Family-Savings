# Deploy Online

Use Render as a simple hosting option.

1. Put this folder in a GitHub repository.
2. Go to Render and create a new Blueprint or Web Service from that repo.
3. Use `render.yaml` if creating a Blueprint.
4. Set `FAMILY_PIN` to `02110630`.
5. Make sure the persistent disk is mounted at `/var/data`.
6. After deploy, open the public Render URL in Safari on iPhone.
7. Tap Share, then Add to Home Screen.

The app stores live data in `DATA_DIR/tracker.json`. On Render that is `/var/data/tracker.json`.
