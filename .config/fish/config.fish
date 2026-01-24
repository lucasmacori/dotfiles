if status is-interactive
# Commands to run in interactive sessions can go here
end

eval "$(zoxide init fish)"
starship init fish | source
