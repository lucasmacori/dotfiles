return {
  "vim-test/vim-test",
  dependencies = {
    "nvim-lua/plenary.nvim",
  },
  cmd = {
    "TestNearest",
    "TestFile",
    "TestSuite",
    "TestLast",
    "TestVisit"
  },
  keys = {
    { "<leader>tt", "<cmd>TestNearest<cr>" },
    { "<leader>tT", "<cmd>TestFile<cr>" },
    { "<leader>ta", "<cmd>TestSuite<cr>" },
    { "<leader>tl", "<cmd>TestLast<cr>" },
  },
  config = function()
    vim.g["test#strategy"] = "neovim_sticky"
  end
}
