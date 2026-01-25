return {
  {
    "nvim-neotest/neotest",
    dependencies = {
      "nvim-neotest/nvim-nio",
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      "antoinemadec/FixCursorHold.nvim",
      "nvim-neotest/neotest-jest",
    },
    keys = {
      {
        "<leader>t",
        function()
          require("neotest").run.run()
        end,
        desc = "Run nearest Jest test",
      },
      {
        "<leader>T",
        function()
          require("neotest").run.run(vim.fn.expand("%"))
        end,
        desc = "Run all tests in file",
      },
    },
    config = function()
      require("neotest").setup({
        adapters = {
          require("neotest-jest")({
            jestCommand = "npm test --",
            jestConfigFile = "jest.config.js",
            env = { CI = true },
            cwd = function()
              return vim.fn.getcwd()
            end,
          }),
        },
      })
    end,
  },
}
