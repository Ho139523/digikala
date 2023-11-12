from django.db import models

# Create your models here.
class category_model(models.Model):
    name=models.CharField(max_length=100, verbose_name='نام دسته‌بندی')
    slug=models.SlugField(max_length=200, verbose_name='آدرس دسته‌بندی')

    class Meta:
        verbose_name='دسته‌بندی'
        verbose_name_plural='دسته‌بندی‌ها'

    def __str__(self):
        return self.name