return {
  {
    "xiyaowong/transparent.nvim",
    init = function()
      vim.g.transparent_enabled = true
    end,
    opts = {
      extra_groups = {
        "NormalFloat",
        "FloatBorder",
        "SnacksNormal",
        "SnacksNormalNC",
        "SnacksWinBar",
        "SnacksWinBarNC",
        "SnacksWinSeparator",
        "SnacksPicker",
        "SnacksPickerBorder",
        "SnacksPickerInput",
        "SnacksPickerList",
        "SnacksPickerPreview",
      },
    },
    config = function(_, opts)
      require("transparent").setup(opts)
      require("transparent").clear_prefix("Snacks")
      require("transparent").clear()
    end,
  },
}
