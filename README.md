# dotfiles

## Setup an Arch based workstation

This script installs all the necessary tools, GUIs, TUIs, CLIs.
It configures Hyprland as the window manager, with Hyprpanel.
It installs custom keymaps and uses sherlock as an app bar.

### Requirements
- Having git installed

### Executing the script

```sh
git clone git@github.com:lucasmacori/dotfiles.git
cd dotfiles
sudo chmod +x setup-arch.sh
```

### Theme

Hyprland and nvim themes are based on rumda config : https://github.com/Nytril-ark/rumda/tree/main

They have been edited to fit my taste but most of it is used.

Keybindings are different, and layout is FR instead of US as I'm using an AZERTY keyboard.

## Setup a Mac

aerospace config is found in .aeropsace.toml.

For alacritty and nvim, the files in .config are fine.
