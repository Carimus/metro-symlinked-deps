workflow "Test and Release" {
  on = "push"
  resolves = ["Test", "Release"]
}

action "Install" {
  uses = "nuxt/actions-yarn@97f98f200b7fd42a001f88e7bdfc14d64d695ab2"
  args = "install"
}

action "Test" {
  needs = "Install"
  uses = "nuxt/actions-yarn@97f98f200b7fd42a001f88e7bdfc14d64d695ab2"
  args = "test"
}

action "Master" {
  needs = "Test"
  uses = "actions/bin/filter@master"
  args = "branch master"
}

action "Release" {
  needs = "Master"
  uses = "nuxt/actions-yarn@97f98f200b7fd42a001f88e7bdfc14d64d695ab2"
  secrets = ["GH_TOKEN", "NPM_TOKEN"]
  args = "release-ci"
}
