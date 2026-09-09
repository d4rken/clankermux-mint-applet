UUID := clankermux-usage@d4rken
APPLET_DIR := $(HOME)/.local/share/cinnamon/applets/$(UUID)
FILES := applet.js metadata.json settings-schema.json stylesheet.css usageModel.js pollingController.js

.PHONY: check test install

check:
	npm run check

test:
	npm test

install: check test
	install -d "$(APPLET_DIR)"
	install -m 0644 $(FILES) "$(APPLET_DIR)/"
	install -d "$(APPLET_DIR)/icons"
	install -m 0644 icons/* "$(APPLET_DIR)/icons/"
	@echo "Installed to $(APPLET_DIR)"
	@echo "Add 'Clankermux Usage' in System Settings > Applets."
