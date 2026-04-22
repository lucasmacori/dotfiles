bind = "SUPER"

-- Basic
hl.bind(bind .. " + R", hl.dsp.exec_cmd("hyprctl reload"))
hl.bind(bind .. " + RETURN", hl.dsp.exec_cmd("alacritty"))
hl.bind(bind .. " + F", hl.dsp.exec_cmd("firefox"))
hl.bind(bind .. " + Q", hl.dsp.window.close())

-- Applications

-- Focus
hl.bind(bind .. " + K", hl.dsp.focus({ direction = "up"  }))
hl.bind(bind .. " + J", hl.dsp.focus({ direction = "down"  }))
hl.bind(bind .. " + H", hl.dsp.focus({ direction = "left"  }))
hl.bind(bind .. " + L", hl.dsp.focus({ direction = "right"  }))

-- Workspaces
hl.bind(bind .. " + AMPERSAND", hl.dsp.focus({ workspace = 1 }))
hl.bind(bind .. " + EACUTE", hl.dsp.focus({ workspace = 2 }))
hl.bind(bind .. " + QUOTEDBL", hl.dsp.focus({ workspace = 3 }))
hl.bind(bind .. " + APOSTROPHE", hl.dsp.focus({ workspace = 4 }))
hl.bind(bind .. " + PARENLEFT", hl.dsp.focus({ workspace = 5 }))
hl.bind(bind .. " + MINUS", hl.dsp.focus({ workspace = 6 }))
hl.bind(bind .. " + EGRAVE", hl.dsp.focus({ workspace = 7 }))
hl.bind(bind .. " + UNDERSCORE", hl.dsp.focus({ workspace = 8 }))
hl.bind(bind .. " + CCEDILLA", hl.dsp.focus({ workspace = 9 }))
hl.bind(bind .. " + AGRAVE", hl.dsp.focus({ workspace = 10 }))

-- Move to workspace
hl.bind(bind .. " + SHIFT + AMPERSAND", hl.dsp.window.move({ workspace = 1 }))
hl.bind(bind .. " + SHIFT + EACUTE", hl.dsp.window.move({ workspace = 2 }))
hl.bind(bind .. " + SHIFT + QUOTEDBL", hl.dsp.window.move({ workspace = 3 }))
hl.bind(bind .. " + SHIFT + APOSTROPHE", hl.dsp.window.move({ workspace = 4 }))
hl.bind(bind .. " + SHIFT + PARENLEFT", hl.dsp.window.move({ workspace = 5 }))
hl.bind(bind .. " + SHIFT + MINUS", hl.dsp.window.move({ workspace = 6 }))
hl.bind(bind .. " + SHIFT + EGRAVE", hl.dsp.window.move({ workspace = 7 }))
hl.bind(bind .. " + SHIFT + UNDERSCORE", hl.dsp.window.move({ workspace = 8 }))
hl.bind(bind .. " + SHIFT + CCEDILLA", hl.dsp.window.move({ workspace = 9 }))
hl.bind(bind .. " + SHIFT + AGRAVE", hl.dsp.window.move({ workspace = 10 }))
