from django.urls import path
from .views import hello_world


app_name='shop'
urlpatterns = [
    path('', hello_world, name='home'),
]