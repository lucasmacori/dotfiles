#!/bin/bash
# This file sets up the work environment in an Arch based Linux distribution
# This needs yay to be installed

# Window manager (Hyprland)
echo "Installing Hyprland..."
yay no-confirm -S hypr ags-hyprpanel-git hyprpaper sherlock-launcher-bin clipse
sudo pacman -Sy greetd greetd-tuigreet xdg-desktop-portal-hyprland
sudo cp ./install_resources/greetd.config.toml /etc/greetd/config.toml
sudo systemctl enable --now greetd

# Terminal, CLIs and TUIs 
echo "Installing terminal tools..."
sudo pacman -Sy alacritty vim nvim tmux git swww lazygit brightnessctl jq less openssh fish zoxide ttf-firacode-nerd
chsh -s $(which fish) # Using fish as default shell
curl -sS https://starship.rs/install.sh | sh # Starship prompt

# GUIs
echo "Installing GUI apps"
sudo pacman -Sy nautilus firefox

# Development tools (Docker, compilers, sdks)
echo "Installing development tools..."
sudo pacman -S docker
sudo systemctl enable docker
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash # nvm (for Node)
curl -s "https://get.sdkman.io" | bash                                          # sdkman (for Java)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh                  # Rust

# Generating ssh key
echo "Generating SSH key"
ssh-keygen -t rsa

# Git config
echo "Setting up git config..."
cp ./.gitconfig ~/.gitconfig

# Setup dotfiles
echo "Setting dotfiles..."
mkdir -p ~/.config
cp -r ./.config/* ~/.config

echo "All done! You can start Hyprland using the 'start-hyprland' command"
