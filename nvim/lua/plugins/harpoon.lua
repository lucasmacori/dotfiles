return {
  {
    "ThePrimeagen/harpoon",
    enabled = false,
    branch = "harpoon2",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      local harpoon = require("harpoon")

      harpoon:setup()

      vim.keymap.set("n", "mh", function() harpoon:list():add() end)
      vim.keymap.set("n", "<leader>a", function() harpoon.ui:toggle_quick_menu(harpoon:list()) end)
    end
  }
}
