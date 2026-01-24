return {
  {
    "lewis6991/gitsigns.nvim",
    event = "User FilePost",
    config = function()
      dofile(vim.g.base46_cache .. "git")
      local gitsigns = require("gitsigns").setup(opts)
      vim.keymap.set('n', '<leader>gb', gitsigns.blame_line, {})
    end
  }
}
