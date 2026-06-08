return {
  {
    "lewis6991/gitsigns.nvim",
    event = { "BufReadPre", "BufNewFile" },
    config = function()
      local gitsigns = require("gitsigns")
      gitsigns.setup()
      vim.keymap.set("n", "<leader>gb", gitsigns.blame_line, {})
    end,
  },
}
