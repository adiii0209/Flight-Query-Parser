"""HR and payroll for a workspace: onboard people, give them a title (Employee, Intern...), and generate offer letters and payslips.

Self-contained: models, defaults, routes and static assets live here.  Main app:  app.register_blueprint(hr_bp)
"""


def __getattr__(name):
    if name == "hr_bp":
        from .routes import hr_bp
        return hr_bp
    raise AttributeError(name)
