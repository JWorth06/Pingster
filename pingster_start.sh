#!/bin/bash

source /run/secrets/env_source.sh
export TWILIO_PHONE_URL=http://sigs.researchnow.com/phonecall.xml
/tini -- node index.js
