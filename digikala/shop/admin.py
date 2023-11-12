from django.contrib import admin
from .models import category_model, customer_model

# Register your models here.
admin.site.register(category_model)
admin.site.register(customer_model)