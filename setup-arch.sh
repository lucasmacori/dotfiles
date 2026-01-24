#!/bin/bash
# This file sets up the work environment in an Arch based Linux distribution

# Setup
sudo pacman -S yay

# Window manager (Hyprland)
echo "Installing Hyprland..."
yay no-confirm -S hypr clipse
sudo pacman -Sy greetd greetd-tuigreet xdg-desktop-portal-hyprland hyprlock quickshell rofi swww mako
sudo cp ./install_resources/greetd.config.toml /etc/greetd/config.toml
sudo systemctl enable --now greetd

# Terminal, CLIs and TUIs
echo "Installing terminal tools..."
sudo pacman -Sy alacritty vim nvim tmux git lazygit brightnessctl jq less openssh fish zoxide ttf-firacode-nerd fisher
chsh -s $(which fish)                        # Using fish as default shell
curl -sS https://starship.rs/install.sh | sh # Starship prompt

# GUIs
echo "Installing GUI apps"
sudo pacman -Sy nautilus firefox

# Development tools (Docker, compilers, sdks)
echo "Installing development tools..."
sudo pacman -S docker
sudo systemctl enable docker
fisher install jorgebucaran/nvm.fish
fisher install reitzig/sdkman-for-fish

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh # Rust

# Git config
echo "Setting up git config..."
cp ./.gitconfig ~/.gitconfig

# Rumda base theme installation
echo "Installing base Rumda theme"
sudo chmod +x ./.config/rumda/install.sh
./.config/rumda/install.sh

# Setup dotfiles
echo "Setting dotfiles and overwriting theme with custom config..."
mkdir -p ~/.config
cp -r ./.config/* ~/.config/

echo "All done! You can start Hyprland using the 'start-hyprland' command"
