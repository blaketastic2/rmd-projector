.PHONY: test

# Runs the calculation tests against the code in index.html. Needs Node 20 or later; no packages to install.
test:
	node --test test/*.test.mjs
