if status is-interactive
    # Commands to run in interactive sessions can go here
end

eval "$(zoxide init fish)"
starship init fish | source
export PATH="$HOME/.local/bin:$PATH"

export OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1
