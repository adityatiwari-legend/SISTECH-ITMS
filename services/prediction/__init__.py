"""ITMS prediction service — traffic prediction with XGBoost.

Python is used ONLY for this ML service (Rules.md 3). It trains on datasets
generated from the SUMO simulation (via TraCI) and exposes POST /predict to
the Node.js backend.
"""
