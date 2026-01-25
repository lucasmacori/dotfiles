return {
  {
    "akinsho/toggleterm.nvim",
    version = "*",
    keys = {
      {
        "<leader>h",
        "<cmd>ToggleTerm<cr>",
        desc = "Toggle terminal",
      },
    },
    opts = {
      size = 20,
      open_mapping = [[<leader>h]],
      direction = "horizontal",
      close_on_exit = true,
      shell = vim.o.shell,
    },
  },
}
