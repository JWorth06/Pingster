#!/bin/bash

source /run/secrets/env_source.sh
/tini -- node index.js
