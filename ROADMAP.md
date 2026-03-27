# AutoHue Roadmap

## Current (v3.2.1)
- [x] AI color classification (Gemini 2.0 Flash via OpenRouter)
- [x] 5-key rotation for high throughput
- [x] ZIP/RAR extraction + bulk processing
- [x] Vehicle type sorting (cars/bikes/people)
- [x] Feature shot detection (burnout/wheelstand/flames/drift)
- [x] Watermark editor
- [x] Auto-update for existing clients
- [x] Landing page at autohue.app

## Next Release (v3.3.0) — Polish
- [ ] Completion screen shows real stats (time saved, cost saved, speed)
- [ ] ZIP download produces valid archive
- [ ] History saves and displays sessions
- [ ] Animation stops on completion
- [ ] Extraction progress bar with green fill
- [ ] ZIP building progress ticker + toast
- [ ] Step numbers (1, 2, 3) on pipeline steps

## Enterprise (v4.0.0) — Vehicle Identification
- [ ] License plate / rego reading from photos
- [ ] Car make/model identification
- [ ] Per-vehicle folders (by rego: CAL4SX/, by model: HSV-Clubsport/)
- [ ] Cross-event database (SQLite: plate -> car_id -> [photos])
- [ ] Recognize same car across different events
- [ ] Customer portal: car owner searches rego -> sees all photos
- [ ] Auto-notify: "47 new photos of your car from Powercruise Feb 2026"
- [ ] Enterprise tier pricing ($299+/month)

## Future Ideas
- [ ] Batch watermarking on sorted output
- [ ] Cloud sync (optional upload to customer portal)
- [ ] Multi-photographer support (merge sorts from different shooters)
- [ ] Print-ready export (resize, crop, frame)
- [ ] Social media auto-post integration
