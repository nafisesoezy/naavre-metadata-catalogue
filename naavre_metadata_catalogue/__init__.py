try:
    from ._version import __version__
except ImportError:
    import warnings
    warnings.warn("Importing 'naavre_metadata_catalogue' outside a proper installation.")
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "naavre-metadata-catalogue-jupyterlab"
    }]