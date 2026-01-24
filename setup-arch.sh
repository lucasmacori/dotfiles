#!/bin/bash
# This file sets up the work environment in an Arch based Linux distribution
# This needs yay to be installed

# Window manager (Hyprland)
echo "Installing Hyprland..."
yay no-confirm -S hypr ags-hyprpanel-git hyprpaper sherlock-launcher-bin clipse
sudo pacman -Sy greetd greetd-tuigreet
cp ./install_resources/greetd.config.toml /etc/greetd/config.toml

# Terminal, clis and tuis
echo "Installing terminal tools..."
sudo pacman -Sy alacritty vim nvim tmux git swww lazygit brightnessctl jq less openssh

# GUIs
echo "Installing GUI apps"
sudo pacman -Sy nautilus firefox

# Development tools (Docker, compilers, sdks)
echo "Installing development tools..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash # nvm (for Node)
curl -s "https://get.sdkman.io" | bash                                          # sdkman (for Java)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh                  # Rust

# Generating ssh key
echo "Generating SSH key"
ssh-keygen -t rsa

# Git config
echo "Setting up git config..."
curl -L -H "Accept: application/vnd.github+json" https://api.github.com/gists/9e4b09d2b96028f79a627c048e8f09f4 | jq -r ".files.git_aliases.content" >>~/.gitconfig

# Setup dotfiles
echo "Setting dotfiles..."
mkdir -p ~/.config
cp -r ./.config/* ~/.config

echo "All done! You can start Hyprland using the 'start-hyprland' command"
