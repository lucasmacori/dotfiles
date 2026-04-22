require("custom.keybinds")

hl.config({
	input = {
		kb_layout = "fr",
		kb_variant = "azerty",
		kb_options = ""
	}
})
hl.monitor({
  output = "eDP-1",
  mode = "1920x1080@60",
  position = "0x0",
  scale = 1,
})
-- hl.config({ scrolling = { direction = "right" } })

-- Theme selection
require("themes.nord.main")
