from django.contrib import admin
from .models import Category_model, Customer_model

# Register your models here.
admin.site.register(Category_model)
admin.site.register(Customer_model)